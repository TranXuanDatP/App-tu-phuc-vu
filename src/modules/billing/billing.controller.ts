/**
 * Billing controllers — REST endpoints for tariff & invoice (route prefixes
 * /billing/tariff and /billing/invoices preserved for FE contract). Thin:
 * route + auth → delegates to BillingService. No CQRS, no validation (lives in
 * the service).
 */
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CustomerId } from '../binding/decorators/current-customer.decorator';
import { BillingService } from './billing.service';

// ═════════════════════════════════════════════════════════════════════════════
// Tariff
// ═════════════════════════════════════════════════════════════════════════════

@ApiTags('Billing — Tariff')
@ApiBearerAuth('JWT-auth')
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
    @CustomerId() customerId: string,
    @Param('contractId') contractId: string,
  ) {
    return this.billingService.getTariffPlan(customerId, contractId);
  }

  /**
   * GET /billing/tariff/:contractId/breakdown?invoiceId=X
   * Get invoice-specific tier breakdown with subtotals (AC#2)
   */
  @Get(':contractId/breakdown')
  @ApiOperation({ summary: 'Get tariff breakdown for an invoice' })
  getTariffBreakdown(
    @CustomerId() customerId: string,
    @Param('contractId') contractId: string,
    @Query('invoiceId') invoiceId: string,
  ) {
    return this.billingService.getTariffBreakdown(customerId, contractId, invoiceId);
  }

  /**
   * GET /billing/tariff/:contractId/fees
   * Get applicable fees (environmental, drainage, VAT, surcharges) (AC#3)
   */
  @Get(':contractId/fees')
  @ApiOperation({ summary: 'Get applicable fees for a contract' })
  getApplicableFees(
    @CustomerId() customerId: string,
    @Param('contractId') contractId: string,
  ) {
    return this.billingService.getApplicableFees(customerId, contractId);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Invoice
// ═════════════════════════════════════════════════════════════════════════════

@ApiTags('Billing — Invoice')
@ApiBearerAuth('JWT-auth')
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
    @CustomerId() customerId: string,
    @Query() query: Record<string, any>,
  ) {
    return this.billingService.getInvoiceList(customerId, query);
  }

  /**
   * GET /billing/invoices/:invoiceId
   * Get invoice detail with line items and CQT code (AC#2)
   */
  @Get(':invoiceId')
  @ApiOperation({ summary: 'Get invoice detail' })
  getInvoiceDetail(
    @CustomerId() customerId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.billingService.getInvoiceDetail(customerId, invoiceId);
  }

  /**
   * GET /billing/invoices/:invoiceId/pdf
   * Get e-invoice PDF URL (AC#3)
   */
  @Get(':invoiceId/pdf')
  @ApiOperation({ summary: 'Get invoice PDF download URL' })
  getInvoicePdf(
    @CustomerId() customerId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.billingService.getInvoicePdf(customerId, invoiceId);
  }
}
