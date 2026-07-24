/**
 * Mock adapter for the payment port (downstream Payment Service).
 * Reads mocks/payment/<method>.json. Swap to a real InternalAdapterBase
 * subclass (passed as the 2nd arg of portRegistry.register) when the downstream
 * service is ready — flip config/api-endpoints.yaml `adapter: live`.
 *
 * Payment port is cacheTier: transaction — PortRegistry NEVER caches responses.
 */
import { Injectable, Logger } from '@nestjs/common';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import {
  CreatePaymentResponseSchema,
  PaymentHistoryResponseSchema,
  CreateBatchPaymentResponseSchema,
  SetupAutoDebitResponseSchema,
} from '../dto/payment.dto';

@Injectable()
export class MockPaymentAdapter extends MockAdapterBase {
  constructor() {
    super(
      'payment',
      {
        'create-payment': CreatePaymentResponseSchema,
        'get-payment-history': PaymentHistoryResponseSchema,
        'create-batch-payment': CreateBatchPaymentResponseSchema,
        'setup-auto-debit': SetupAutoDebitResponseSchema,
      },
      new Logger('payment-mock-adapter'),
    );
  }
}
