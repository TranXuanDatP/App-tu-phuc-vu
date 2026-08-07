/**
 * Mock adapter for the meter port (downstream Meter service).
 *
 * OWNER-SCOPED (A2 Layer-2): reads the raw meter list (mocks/meter/get-meter-by-customer.json,
 * which carries a server-side `ownerCustomerId` per meter) and enforces ownership —
 * `get-meter-by-customer` returns only the bound customer's meters, and calibration/history
 * for another customer's meterId → 404 (same shape as not-found, no oracle). `ownerCustomerId`
 * is stripped from the response (server-side ownership mark, never exposed).
 *
 * This is the IDOR fix at the data layer (same pattern as MockInvoiceAdapter): the BFF passes
 * the BOUND customerId and the mock scopes by it. Swap to an InternalAdapterBase subclass when
 * the real downstream is ready — ownership then enforced downstream by the same customerId.
 *
 * Methods: get-meter-by-customer, get-calibration-status, get-meter-history
 */
import { Injectable, Logger } from '@nestjs/common';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import { NotFoundException } from '@core/common';
import {
  MeterListResponseSchema,
  CalibrationStatusRawSchema,
  MeterHistoryResponseSchema,
} from '../dto/meter.dto';

interface RawMeter {
  meterId: string;
  ownerCustomerId: string;
  [k: string]: unknown;
}

@Injectable()
export class MockMeterAdapter extends MockAdapterBase {
  private rawCache?: RawMeter[];

  constructor() {
    super(
      'meter',
      {
        'get-meter-by-customer': MeterListResponseSchema,
        'get-calibration-status': CalibrationStatusRawSchema,
        'get-meter-history': MeterHistoryResponseSchema,
      },
      new Logger('meter-mock-adapter'),
    );
  }

  override async execute(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (method === 'get-meter-by-customer') {
      return this.getByCustomer(params);
    }
    if (
      params.meterId &&
      (method === 'get-calibration-status' || method === 'get-meter-history')
    ) {
      await this.assertOwned(
        String(params.meterId),
        params.customerId as string | undefined,
      );
      // inject the requested meterId into the per-meter fixture
      const data = await super.execute(method, params);
      if (data && typeof data === 'object') {
        return { ...(data as object), meterId: params.meterId };
      }
    }
    return super.execute(method, params);
  }

  /** get-meter-by-customer scoped to the bound customer. */
  private async getByCustomer(params: Record<string, unknown>) {
    const all = await this.loadRaw();
    const customerId = params.customerId as string | undefined;
    const owned = customerId
      ? all.filter((m) => m.ownerCustomerId === customerId)
      : all;
    return {
      meters: owned.map(({ ownerCustomerId: _o, ...rest }) => rest),
      totalCount: owned.length,
    };
  }

  /** 404 if the meterId is not owned by the bound customer (no oracle vs not-found). */
  private async assertOwned(
    meterId: string,
    customerId: string | undefined,
  ): Promise<void> {
    const all = await this.loadRaw();
    const meter = all.find((m) => m.meterId === meterId);
    if (!meter || (customerId && meter.ownerCustomerId !== customerId)) {
      throw new NotFoundException('Meter not found', 'METER_NOT_FOUND', {
        meterId,
      });
    }
  }

  /** Read the raw meter list once (with ownerCustomerId), bypassing Zod stripping. */
  private async loadRaw(): Promise<RawMeter[]> {
    if (this.rawCache) return this.rawCache;
    const filePath = path.resolve(
      process.cwd(),
      'mocks',
      'meter',
      'get-meter-by-customer.json',
    );
    const raw = JSON.parse(await fsPromises.readFile(filePath, 'utf-8')) as {
      meters?: RawMeter[];
    };
    this.rawCache = raw.meters ?? [];
    return this.rawCache;
  }
}
