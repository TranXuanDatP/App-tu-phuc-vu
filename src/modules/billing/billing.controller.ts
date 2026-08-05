/**
 * Billing controllers — REST endpoints for tariff & invoice (route prefixes
 * /billing/tariff and /billing/invoices preserved for FE contract). Thin:
 * route + auth → delegates to BillingService. No CQRS, no validation (lives in
 * the service).
 */
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/infrastructure/decorators/current-user.decorator';
import { RequiresBinding } from '../binding/decorators/requires-binding.decorator';
import { BillingService } from './billing.service';

// ═════════════════════════════════════════════════════════════════════════════
// Tariff
// ═════════════════════════════════════════════════════════════════════════════

@ApiTags('Billing — Tariff')
@ApiBearerAuth('JWT-auth')
@RequiresBinding()
@Controller('billing/tariff')
export class TariffController {
  constructor(private readonly billingService: BillingService) {}

  /**
   * GET /billing/tariff/:contractId
   * Get tiered pricing plan for a contract (AC#1)
   */
  @Get(':contractId')
  @ApiOperation({ summary: 'Get tariff plan for a contract' })
  getTariffPlan(
    @CurrentUser('id') userId: string,
    @Param('contractId') contractId: string,
  ) {
    return this.billingService.getTariffPlan(userId, contractId);
  }

  /**
   * GET /billing/tariff/:contractId/breakdown?invoiceId=X
   * Get invoice-specific tier breakdown with subtotals (AC#2)
   */
  @Get(':contractId/breakdown')
  @ApiOperation({ summary: 'Get tariff breakdown for an invoice' })
  getTariffBreakdown(
    @CurrentUser('id') userId: string,
    @Param('contractId') contractId: string,
    @Query('invoiceId') invoiceId: string,
  ) {
    return this.billingService.getTariffBreakdown(userId, contractId, invoiceId);
  }

  /**
   * GET /billing/tariff/:contractId/fees
   * Get applicable fees (environmental, drainage, VAT, surcharges) (AC#3)
   */
  @Get(':contractId/fees')
  @ApiOperation({ summary: 'Get applicable fees for a contract' })
  getApplicableFees(
    @CurrentUser('id') userId: string,
    @Param('contractId') contractId: string,
  ) {
    return this.billingService.getApplicableFees(userId, contractId);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Invoice
// ═════════════════════════════════════════════════════════════════════════════

@ApiTags('Billing — Invoice')
@ApiBearerAuth('JWT-auth')
@RequiresBinding()
@Controller('billing/invoices')
export class InvoiceController {
  constructor(private readonly billingService: BillingService) {}

  /**
   * GET /billing/invoices?month=YYYY-MM&status=paid|unpaid|overdue&page=1&limit=10
   * Get paginated invoice list with optional filters (AC#1)
   */
  @Get()
  @ApiOperation({ summary: 'Get paginated invoice list' })
  getInvoiceList(
    @CurrentUser('id') userId: string,
    @Query() query: Record<string, any>,
  ) {
    return this.billingService.getInvoiceList(userId, query);
  }

  /**
   * GET /billing/invoices/:invoiceId
   * Get invoice detail with line items and CQT code (AC#2)
   */
  @Get(':invoiceId')
  @ApiOperation({ summary: 'Get invoice detail' })
  getInvoiceDetail(
    @CurrentUser('id') userId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.billingService.getInvoiceDetail(userId, invoiceId);
  }

  /**
   * GET /billing/invoices/:invoiceId/pdf
   * Get e-invoice PDF URL (AC#3)
   */
  @Get(':invoiceId/pdf')
  @ApiOperation({ summary: 'Get invoice PDF download URL' })
  getInvoicePdf(
    @CurrentUser('id') userId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.billingService.getInvoicePdf(userId, invoiceId);
  }
}
