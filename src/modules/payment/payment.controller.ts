/**
 * Payment controllers — REST endpoints for payments, debt & webhooks (route
 * prefixes /payments, /payments/debt, /webhooks/payment preserved for FE
 * contract). Thin: route + auth → delegates to PaymentService. No CQRS, no
 * validation (lives in the service).
 */
import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/infrastructure/decorators/current-user.decorator';
import { Public } from '@modules/auth/infrastructure/decorators/public.decorator';
import { InterServiceApiKeyGuard } from '@shared/security';
import { PaymentService } from './payment.service';

// ═════════════════════════════════════════════════════════════════════════════
// Payments
// ═════════════════════════════════════════════════════════════════════════════

@ApiTags('Payment')
@ApiBearerAuth('JWT-auth')
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  /**
   * POST /payments
   * Initiate payment for an invoice → returns QR code or payment link (AC#1)
   */
  @Post()
  @ApiOperation({ summary: 'Initiate payment for an invoice' })
  createPayment(
    @CurrentUser('id') userId: string,
    @Body() body: unknown,
  ) {
    return this.paymentService.createPayment(userId, body);
  }

  /**
   * GET /payments/history?page=1&limit=10&status=completed
   * Get payment history (paginated) — AC#1
   */
  @Get('history')
  @ApiOperation({ summary: 'Get payment history (paginated)' })
  getPaymentHistory(
    @CurrentUser('id') userId: string,
    @Query() query: Record<string, any>,
  ) {
    return this.paymentService.getPaymentHistory(userId, query);
  }

  /**
   * POST /payments/batch
   * Pay multiple invoices at once → single QR code / payment link (AC#2)
   */
  @Post('batch')
  @ApiOperation({ summary: 'Pay multiple invoices at once' })
  createBatchPayment(
    @CurrentUser('id') userId: string,
    @Body() body: unknown,
  ) {
    return this.paymentService.createBatchPayment(userId, body);
  }

  /**
   * POST /payments/auto-debit
   * Register bank account for automatic bill payment (AC#1)
   */
  @Post('auto-debit')
  @ApiOperation({ summary: 'Register auto debit for automatic bill payment' })
  setupAutoDebit(
    @CurrentUser('id') userId: string,
    @Body() body: unknown,
  ) {
    return this.paymentService.setupAutoDebit(userId, body);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Debt
// ═════════════════════════════════════════════════════════════════════════════

@ApiTags('Payment — Debt')
@ApiBearerAuth('JWT-auth')
@Controller('payments/debt')
export class DebtController {
  constructor(private readonly paymentService: PaymentService) {}

  /**
   * GET /payments/debt
   * Get outstanding debt with aging buckets (AC#1)
   */
  @Get()
  @ApiOperation({ summary: 'Get outstanding debt with aging buckets' })
  getOutstandingDebt(@CurrentUser('id') userId: string) {
    return this.paymentService.getOutstandingDebt(userId);
  }

  /**
   * GET /payments/debt/history
   * Get chronological debt history (AC#2)
   */
  @Get('history')
  @ApiOperation({ summary: 'Get debt history' })
  getDebtHistory(@CurrentUser('id') userId: string) {
    return this.paymentService.getDebtHistory(userId);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Webhook
// ═════════════════════════════════════════════════════════════════════════════

/**
 * @Public() — Webhook receives calls from Payment Service via x-api-key,
 * not browser sessions. Must bypass global SessionAuthGuard.
 * Guarded by InterServiceApiKeyGuard — static API key verification (FR72).
 */
@Public()
@ApiTags('Webhooks — Payment')
@Controller('webhooks/payment')
@UseGuards(InterServiceApiKeyGuard)
export class WebhookController {
  constructor(private readonly paymentService: PaymentService) {}

  /**
   * POST /webhooks/payment/ipn
   * Payment Service IPN (Instant Payment Notification) (AC#1)
   * Returns 200 always — webhook acknowledgment
   */
  @Post('ipn')
  @ApiOperation({ summary: 'Payment IPN webhook (internal service)' })
  @ApiHeader({ name: 'x-api-key', description: 'Inter-service static API key' })
  async handlePaymentIpn(@Body() body: Record<string, unknown>) {
    // Always dispatch — service manages idempotency internally
    await this.paymentService.handleWebhook(body);
    return { received: true };
  }
}
