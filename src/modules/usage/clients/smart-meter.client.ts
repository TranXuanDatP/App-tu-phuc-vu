/**
 * Mock adapter for the smart-meter port (downstream Smart Meter service).
 *
 * OWNER-SCOPED for get-meter-status (A2 Layer-2 sub-path): a bound customer can only read
 * the status of their own meter. Ownership source = mocks/meter/get-meter-by-customer.json
 * (the meter list with server-side `ownerCustomerId`). Status for another customer's meterId,
 * or an unknown meterId → 404 (same shape as not-found, no oracle).
 *
 * `get-realtime-consumption` is customer-scoped (takes customerId, no cross-customer
 * selector) — it stays on the fixture (downstream will scope by customerId live).
 *
 * Methods: get-realtime-consumption, get-meter-status
 */
import { Injectable, Logger } from '@nestjs/common';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import { NotFoundException } from '@core/common';
import { RealtimeConsumptionSchema, SmartMeterStatusSchema } from '../dto/smart-meter.dto';

interface MeterOwnerRow {
  meterId: string;
  ownerCustomerId: string;
}

@Injectable()
export class MockSmartMeterAdapter extends MockAdapterBase {
  private meterOwnersCache?: MeterOwnerRow[];

  constructor() {
    super(
      'smart-meter',
      {
        'get-realtime-consumption': RealtimeConsumptionSchema,
        'get-meter-status': SmartMeterStatusSchema,
      },
      new Logger('smart-meter-mock-adapter'),
    );
  }

  override async execute(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (method === 'get-meter-status' && params.meterId) {
      await this.assertOwned(
        String(params.meterId),
        params.customerId as string | undefined,
      );
    }
    return super.execute(method, params);
  }

  private async assertOwned(
    meterId: string,
    customerId: string | undefined,
  ): Promise<void> {
    const owners = await this.loadMeterOwners();
    const meter = owners.find((m) => m.meterId === meterId);
    if (!meter || (customerId && meter.ownerCustomerId !== customerId)) {
      throw new NotFoundException('Meter not found', 'METER_NOT_FOUND', {
        meterId,
      });
    }
  }

  /** Reuse the meter list (mocks/meter/get-meter-by-customer.json) as the ownership source. */
  private async loadMeterOwners(): Promise<MeterOwnerRow[]> {
    if (this.meterOwnersCache) return this.meterOwnersCache;
    const filePath = path.resolve(
      process.cwd(),
      'mocks',
      'meter',
      'get-meter-by-customer.json',
    );
    const raw = JSON.parse(await fsPromises.readFile(filePath, 'utf-8')) as {
      meters?: MeterOwnerRow[];
    };
    this.meterOwnersCache =
      (raw.meters ?? []).map((m) => ({
        meterId: m.meterId,
        ownerCustomerId: m.ownerCustomerId,
      }));
    return this.meterOwnersCache;
  }
}
