/**
 * Mock adapter for the contract port (downstream Contract service).
 *
 * OWNER-SCOPED (A2 Layer-2): reads the raw contract list
 * (mocks/contract/get-contracts.json, server-side `ownerCustomerId` per contract) and
 * enforces ownership — `get-contracts` returns only the bound customer's contracts;
 * detail/versions/pdf for another customer's contractId → 404 (same shape as not-found).
 * `ownerCustomerId` is stripped from the response. Same pattern as MockInvoiceAdapter /
 * MockMeterAdapter. Swap to InternalAdapterBase when the real downstream is ready.
 *
 * Methods: get-contracts, get-contract-detail, get-contract-versions, get-contract-pdf
 */
import { Injectable, Logger } from '@nestjs/common';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import { NotFoundException } from '@core/common';
import {
  ContractListResponseSchema,
  ContractDetailResponseSchema,
  ContractVersionsResponseSchema,
  ContractPDFResponseSchema,
} from '../dto/contract.dto';

interface RawContract {
  contractId: string;
  ownerCustomerId: string;
  [k: string]: unknown;
}

@Injectable()
export class MockContractAdapter extends MockAdapterBase {
  private rawCache?: RawContract[];

  constructor() {
    super(
      'contract',
      {
        'get-contracts': ContractListResponseSchema,
        'get-contract-detail': ContractDetailResponseSchema,
        'get-contract-versions': ContractVersionsResponseSchema,
        'get-contract-pdf': ContractPDFResponseSchema,
      },
      new Logger('contract-mock-adapter'),
    );
  }

  override async execute(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (method === 'get-contracts') {
      return this.getContracts(params);
    }
    if (
      params.contractId &&
      (method === 'get-contract-detail' ||
        method === 'get-contract-versions' ||
        method === 'get-contract-pdf')
    ) {
      await this.assertOwned(
        String(params.contractId),
        params.customerId as string | undefined,
      );
      const data = await super.execute(method, params);
      if (data && typeof data === 'object') {
        return { ...(data as object), contractId: params.contractId };
      }
    }
    return super.execute(method, params);
  }

  private async getContracts(params: Record<string, unknown>) {
    const all = await this.loadRaw();
    const customerId = params.customerId as string | undefined;
    const owned = customerId
      ? all.filter((c) => c.ownerCustomerId === customerId)
      : all;
    return {
      contracts: owned.map(({ ownerCustomerId: _o, ...rest }) => rest),
      totalCount: owned.length,
    };
  }

  private async assertOwned(
    contractId: string,
    customerId: string | undefined,
  ): Promise<void> {
    const all = await this.loadRaw();
    const contract = all.find((c) => c.contractId === contractId);
    if (!contract || (customerId && contract.ownerCustomerId !== customerId)) {
      throw new NotFoundException('Contract not found', 'CONTRACT_NOT_FOUND', {
        contractId,
      });
    }
  }

  private async loadRaw(): Promise<RawContract[]> {
    if (this.rawCache) return this.rawCache;
    const filePath = path.resolve(
      process.cwd(),
      'mocks',
      'contract',
      'get-contracts.json',
    );
    const raw = JSON.parse(await fsPromises.readFile(filePath, 'utf-8')) as {
      contracts?: RawContract[];
    };
    this.rawCache = raw.contracts ?? [];
    return this.rawCache;
  }
}
