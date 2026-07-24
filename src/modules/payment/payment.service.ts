/**
 * Payment service — lean BFF orchestrator over the payment + debt ports.
 * Methods are the former CQRS handlers' execute() bodies:
 *   - createPayment        (was CreatePaymentHandler)
 *   - getPaymentHistory    (was GetPaymentHistoryHandler)
 *   - createBatchPayment   (was CreateBatchPaymentHandler)
 *   - setupAutoDebit       (was SetupAutoDebitHandler)
 *   - getOutstandingDebt   (was GetOutstandingDebtHandler)
 *   - getDebtHistory       (was GetDebtHistoryHandler)
 *   - handleWebhook        (was HandlePaymentWebhookHandler)
 *
 * Two ports: payment (cacheTier: transaction — NO CACHE) +
 *            debt    (cacheTier: dynamic — 5-15 min cache).
 * createPayment / createBatchPayment also verify invoices via the shared
 * 'invoice' port (registered by BillingModule).
 *
 * Input validation (Zod safeParse → ValidationException) lives here.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PortRegistry } from '@shared/port';
import type { PortResult } from '@shared/port/port.interface';
import { PortFallbackException } from '@shared/port/port-exceptions';
import { CACHE_SERVICE_TOKEN } from '@core/constants/tokens';
import type { ICacheService } from '@shared/caching/cache.interface';
import { IdempotencyService } from '@shared/idempotency';
import { ForbiddenException, NotFoundException, ValidationException } from '@core/common';
import type { InvoiceDetail } from '@modules/billing/dto/invoice.dto';
import {
  CreatePaymentRequestSchema,
  CreateBatchPaymentRequestSchema,
  PaymentHistoryQuerySchema,
  SetupAutoDebitRequestSchema,
  PaymentWebhookPayloadSchema,
} from './dto/payment.dto';
import type {
  CreatePaymentResponse,
  PaymentHistoryResponse,
  CreateBatchPaymentResponse,
  SetupAutoDebitResponse,
  PaymentWebhookPayload,
} from './dto/payment.dto';
import type {
  OutstandingDebtResponse,
  DebtHistoryResponse,
} from './dto/debt.dto';

/** Result shape for handleWebhook (was HandlePaymentWebhookResult). */
export type HandlePaymentWebhookResult = {
  processed: boolean;
  paymentId: string;
  status: 'success' | 'failed' | 'duplicate';
};

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly portRegistry: PortRegistry,
    @Inject(CACHE_SERVICE_TOKEN) private readonly cacheService: ICacheService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  // ── Payment port (cacheTier: transaction — NO CACHE) ────────────────────────

  /**
   * AC#1 — POST /payments: verify invoice unpaid (useCache: false) then create
   * payment → returns QR code / payment link.
   */
  async createPayment(customerId: string, body: unknown): Promise<CreatePaymentResponse> {
    const validated = CreatePaymentRequestSchema.safeParse(body);
    if (!validated.success) {
      throw new ValidationException('Invalid payment request');
    }
    const { invoiceId, method } = validated.data;

    // Step 1: Verify invoice exists and is unpaid (useCache: false — transaction context)
    this.logger.log(`Verifying invoice ${invoiceId} for payment`);
    const invoiceResult: PortResult<InvoiceDetail> =
      await this.portRegistry.execute<InvoiceDetail>('invoice', 'get-by-id', {
        invoiceId,
        customerId,
        useCache: false,
      });
    const invoice = invoiceResult?.data;
    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }
    if (invoice.paymentStatus !== 'unpaid') {
      throw new ForbiddenException(
        `Invoice ${invoiceId} is not available for payment. Current status: ${invoice.paymentStatus}`,
      );
    }

    // Step 2: Create payment (cacheTier: transaction → NO CACHE)
    this.logger.log(`Creating payment for invoice ${invoiceId}, method: ${method}`);
    const paymentResult: PortResult<CreatePaymentResponse> =
      await this.portRegistry.execute<CreatePaymentResponse>('payment', 'create-payment', {
        invoiceId,
        customerId,
        method,
        amount: invoice.totalAmount,
      });
    const payment = paymentResult.data;
    if (!payment) {
      throw new NotFoundException(
        `Payment creation failed for invoice ${invoiceId} — no response from payment service`,
      );
    }
    this.logger.log(`Payment created: ${payment.paymentId} for invoice ${invoiceId}`);
    return payment;
  }

  /** AC#1 — GET /payments/history: paginated payment history. */
  async getPaymentHistory(
    customerId: string,
    query: Record<string, unknown>,
  ): Promise<PaymentHistoryResponse> {
    const validated = PaymentHistoryQuerySchema.safeParse(query);
    if (!validated.success) {
      throw new ValidationException('Invalid query parameters');
    }
    const result = await this.portRegistry.execute<PaymentHistoryResponse>(
      'payment',
      'get-payment-history',
      { customerId, filters: validated.data },
    );
    if (!result.data) {
      throw new NotFoundException(`Payment history not available for customer ${customerId}`);
    }
    return result.data;
  }

  /**
   * AC#2 — POST /payments/batch: verify ALL invoices unpaid (useCache: false),
   * accumulate totalAmount, then create a single batch payment.
   */
  async createBatchPayment(
    customerId: string,
    body: unknown,
  ): Promise<CreateBatchPaymentResponse> {
    const validated = CreateBatchPaymentRequestSchema.safeParse(body);
    if (!validated.success) {
      throw new ValidationException('Invalid batch payment request');
    }
    const { invoiceIds, method } = validated.data;

    // Verify ALL invoices are unpaid (sequential — useCache: false for each)
    let totalAmount = 0;
    for (const invoiceId of invoiceIds) {
      const invoiceResult: PortResult<InvoiceDetail> =
        await this.portRegistry.execute<InvoiceDetail>('invoice', 'get-by-id', {
          invoiceId,
          customerId,
          useCache: false,
        });
      const invoice = invoiceResult?.data;
      if (!invoice) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }
      if (invoice.paymentStatus !== 'unpaid') {
        throw new ForbiddenException(
          `Invoice ${invoiceId} is not available for payment. Current status: ${invoice.paymentStatus}`,
        );
      }
      totalAmount += invoice.totalAmount;
    }

    this.logger.log(
      `Batch payment: ${invoiceIds.length} invoices, total: ${totalAmount}, method: ${method}`,
    );
    const paymentResult: PortResult<CreateBatchPaymentResponse> =
      await this.portRegistry.execute<CreateBatchPaymentResponse>(
        'payment',
        'create-batch-payment',
        { invoiceIds, customerId, method, totalAmount },
      );
    this.logger.log(
      `Batch payment created: ${paymentResult.data.paymentId} for ${invoiceIds.length} invoices`,
    );
    return paymentResult.data;
  }

  /** AC#1 — POST /payments/auto-debit: register bank account for auto bill pay. */
  async setupAutoDebit(customerId: string, body: unknown): Promise<SetupAutoDebitResponse> {
    const validated = SetupAutoDebitRequestSchema.safeParse(body);
    if (!validated.success) {
      throw new ValidationException('Invalid auto debit request');
    }
    this.logger.log('Auto debit registration initiated');
    const result: PortResult<SetupAutoDebitResponse> =
      await this.portRegistry.execute<SetupAutoDebitResponse>('payment', 'setup-auto-debit', {
        customerId,
        bankAccount: validated.data.bankAccount,
      });
    if (!result.data) {
      throw new NotFoundException(
        'Auto debit registration failed — no response from payment service',
      );
    }
    this.logger.log(
      `Auto debit registered: ${result.data.registrationId}, status: ${result.data.status}`,
    );
    return result.data;
  }

  // ── Debt port (cacheTier: dynamic — 5-15 min cache) ──────────────────────────

  /** AC#1 — GET /payments/debt: outstanding debt with aging buckets. */
  async getOutstandingDebt(customerId: string): Promise<OutstandingDebtResponse> {
    const result = await this.portRegistry.execute<OutstandingDebtResponse>(
      'debt',
      'get-outstanding-debt',
      { customerId },
    );
    if (!result?.data) {
      throw new PortFallbackException('debt');
    }
    return result.data;
  }

  /** AC#2 — GET /payments/debt/history: chronological debt history. */
  async getDebtHistory(customerId: string): Promise<DebtHistoryResponse> {
    const result = await this.portRegistry.execute<DebtHistoryResponse>(
      'debt',
      'get-debt-history',
      { customerId },
    );
    if (!result?.data) {
      throw new PortFallbackException('debt');
    }
    return result.data;
  }

  // ── Webhook (was HandlePaymentWebhookHandler) ───────────────────────────────

  /**
   * AC#2/#3/#4/#5 — POST /webhooks/payment/ipn: process inbound payment IPN.
   *  1. Idempotency check (duplicate → return cached 'duplicate' result)
   *  2. success → pattern-based cache invalidation (invoice + debt) +
   *               notification dispatch via port
   *  3. failed  → PII-redacted log + notification dispatch via port
   *  4. store idempotency result
   */
  async handleWebhook(body: unknown): Promise<HandlePaymentWebhookResult> {
    const validated = PaymentWebhookPayloadSchema.safeParse(body);
    if (!validated.success) {
      throw new ValidationException('Invalid payment webhook payload');
    }
    const payload: PaymentWebhookPayload = validated.data;
    const { paymentId, invoiceId, customerId, amount, status } = payload;

    // AC#4: Idempotency check — duplicate webhook?
    const existing =
      await this.idempotencyService.getExisting<HandlePaymentWebhookResult>(paymentId);
    if (existing) {
      this.logger.log(`Duplicate webhook ignored: ${paymentId}`);
      return { processed: false, paymentId, status: 'duplicate' };
    }

    const result: HandlePaymentWebhookResult = {
      processed: true,
      paymentId,
      status: status === 'success' ? 'success' : 'failed',
    };

    if (status === 'success') {
      // AC#2: Pattern-based cache invalidation (legit BFF cache-bust for invoice + debt)
      const deletedCount = await this.cacheService.deleteByPattern('cache:v2:port:invoice:*');
      this.logger.log(
        `Payment success: ${paymentId}. Invalidated ${deletedCount} invoice cache keys`,
      );
      const debtDeleted = await this.cacheService.deleteByPattern('cache:v2:port:debt:*');
      this.logger.log(`Invalidated ${debtDeleted} debt cache keys`);

      // AC#5: Notification dispatch via port (lean BFF)
      try {
        await this.portRegistry.execute('notification', 'dispatch-notification', {
          customerId,
          type: 'payment_completed',
          isCritical: true,
          invoiceId,
          amount,
          metadata: { paymentId },
        });
      } catch (err) {
        this.logger.warn(
          `Notification dispatch failed for payment_completed: ${(err as Error).message}`,
        );
      }
    } else {
      // AC#3: Failed payment — log with PII redacted
      this.logger.warn(
        `Payment failed: ${paymentId}, invoiceId=${invoiceId}, amount=[REDACTED]`,
      );

      // AC#5: Notification dispatch via port (lean BFF)
      try {
        await this.portRegistry.execute('notification', 'dispatch-notification', {
          customerId,
          type: 'payment_failed',
          isCritical: true,
          invoiceId,
          metadata: { paymentId, status },
        });
      } catch (err) {
        this.logger.warn(
          `Notification dispatch failed for payment_failed: ${(err as Error).message}`,
        );
      }
    }

    // Store idempotency result
    await this.idempotencyService.store(paymentId, result, 'HandlePaymentWebhook');
    return result;
  }
}
