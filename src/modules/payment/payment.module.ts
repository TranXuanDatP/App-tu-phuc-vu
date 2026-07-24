/**
 * Payment module — lean BFF module (4-part: controller + service + dto + clients).
 * Registers the payment + debt mock ports. No domain/, no CQRS handlers.
 *
 * Two ports, one module:
 *   payment — cacheTier: transaction (NO CACHING, FR35)
 *   debt    — cacheTier: dynamic (5-15 min cache, FR39/FR40)
 *
 * The 'invoice' port used by createPayment/createBatchPayment is registered by
 * BillingModule (imported independently in app.module.ts).
 */
import { Module, OnModuleInit } from '@nestjs/common';
import { PortRegistry } from '@shared/port';
import { IdempotencyService } from '@shared/idempotency';
import { PaymentController, DebtController, WebhookController } from './payment.controller';
import { PaymentService } from './payment.service';
import { MockPaymentAdapter } from './clients/payment.client';
import { MockDebtAdapter } from './clients/debt.client';

@Module({
  controllers: [PaymentController, DebtController, WebhookController],
  providers: [PaymentService, MockPaymentAdapter, MockDebtAdapter, IdempotencyService],
})
export class PaymentModule implements OnModuleInit {
  constructor(
    private readonly portRegistry: PortRegistry,
    private readonly mockPaymentAdapter: MockPaymentAdapter,
    private readonly mockDebtAdapter: MockDebtAdapter,
  ) {}

  onModuleInit() {
    // Payment: transaction tier — NO CACHE (FR35)
    this.portRegistry.register('payment', this.mockPaymentAdapter, this.mockPaymentAdapter);
    // Debt: dynamic tier — 5-15 min cache (FR39/FR40)
    this.portRegistry.register('debt', this.mockDebtAdapter, this.mockDebtAdapter);
  }
}
