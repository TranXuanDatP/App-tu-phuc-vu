/**
 * Mock adapter for the debt port (downstream Debt Service).
 * Reads mocks/debt/<method>.json. Swap to a real InternalAdapterBase
 * subclass (passed as the 2nd arg of portRegistry.register) when the downstream
 * service is ready — flip config/api-endpoints.yaml `adapter: live`.
 *
 * Debt port is cacheTier: dynamic — responses cached 5-15 min.
 */
import { Injectable, Logger } from '@nestjs/common';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import {
  OutstandingDebtResponseSchema,
  DebtHistoryResponseSchema,
} from '../dto/debt.dto';

@Injectable()
export class MockDebtAdapter extends MockAdapterBase {
  constructor() {
    super(
      'debt',
      {
        'get-outstanding-debt': OutstandingDebtResponseSchema,
        'get-debt-history': DebtHistoryResponseSchema,
      },
      new Logger('debt-mock-adapter'),
    );
  }
}
