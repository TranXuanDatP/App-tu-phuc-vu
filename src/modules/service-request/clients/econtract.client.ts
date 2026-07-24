/**
 * Mock adapter for the econtract port (downstream e-Contract service).
 * Reads mocks/econtract/<method>.json. Swap to a real InternalAdapterBase
 * subclass (passed as the 2nd arg of portRegistry.register) when the downstream
 * service is ready — flip config/api-endpoints.yaml `adapter: live`.
 *
 * Methods: get-contract, sign-contract
 */
import { Injectable, Logger } from '@nestjs/common';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import { EcontractResponseSchema, SignContractResultSchema } from '../dto/econtract.dto';

@Injectable()
export class MockEcontractAdapter extends MockAdapterBase {
  constructor() {
    super(
      'econtract',
      {
        'get-contract': EcontractResponseSchema,
        'sign-contract': SignContractResultSchema,
      },
      new Logger('econtract-mock-adapter'),
    );
  }
}
