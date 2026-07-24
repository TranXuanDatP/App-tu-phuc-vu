/**
 * Mock adapter for the contract port (downstream Contract service).
 * Reads mocks/contract/<method>.json. Swap to a real InternalAdapterBase
 * subclass (passed as the 2nd arg of portRegistry.register) when the downstream
 * service is ready — flip config/api-endpoints.yaml `adapter: live`.
 *
 * Methods: get-contracts, get-contract-detail, get-contract-versions, get-contract-pdf
 */
import { Injectable, Logger } from '@nestjs/common';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import {
  ContractListResponseSchema,
  ContractDetailResponseSchema,
  ContractVersionsResponseSchema,
  ContractPDFResponseSchema,
} from '../dto/contract.dto';

@Injectable()
export class MockContractAdapter extends MockAdapterBase {
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
}
