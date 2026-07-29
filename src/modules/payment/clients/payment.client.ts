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
  private static paymentCounter = 0;

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

  override async execute(method: string, params: Record<string, unknown>): Promise<unknown> {
    // Generate a unique paymentId per create request (was always PAY-2026-001).
    if (method === 'create-payment') {
      const data = await super.execute(method, params);
      if (data && typeof data === 'object') {
        MockPaymentAdapter.paymentCounter += 1;
        const seq = String(MockPaymentAdapter.paymentCounter).padStart(3, '0');
        return {
          ...(data as object),
          paymentId: `PAY-2026-${seq}`,
          invoiceId: params.invoiceId ?? (data as { invoiceId?: string }).invoiceId,
        };
      }
    }
    return super.execute(method, params);
  }
}
