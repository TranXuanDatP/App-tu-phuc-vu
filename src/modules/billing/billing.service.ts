/**
 * Billing service — lean BFF orchestrator over the tariff + invoice ports.
 * Thin pass-through to PortRegistry; no business logic. Methods are the former
 * CQRS handlers' execute() bodies (get-tariff-plan, get-tariff-breakdown,
 * get-applicable-fees, get-invoice-list, get-invoice-detail, get-invoice-pdf).
 * Input validation (moved from the old controllers) lives here.
 */
import { Injectable } from '@nestjs/common';
import { PortRegistry } from '@shared/port';
import { ValidationException } from '@core/common';
import {
  InvoiceListQuerySchema,
  InvoiceIdParamSchema,
} from './dto/invoice.dto';
import { ContractIdParamSchema } from './dto/tariff.dto';
import type {
  InvoiceListResponse,
  InvoiceDetail,
  InvoicePdf,
} from './dto/invoice.dto';
import type {
  TariffPlan,
  TariffBreakdown,
  ApplicableFeesResponse,
} from './dto/tariff.dto';

@Injectable()
export class BillingService {
  constructor(private readonly portRegistry: PortRegistry) {}

  // ── Invoice port ─────────────────────────────────────────────────────────────

  /** AC#1 — GET /billing/invoices: paginated invoice list with optional filters. */
  async getInvoiceList(
    customerId: string,
    query: Record<string, any>,
  ): Promise<InvoiceListResponse> {
    const validated = InvoiceListQuerySchema.safeParse(query);
    if (!validated.success) {
      throw new ValidationException('Invalid query parameters');
    }
    const result = await this.portRegistry.execute<InvoiceListResponse>(
      'invoice',
      'get-list',
      { customerId, ...validated.data },
    );
    return result.data;
  }

  /** AC#2 — GET /billing/invoices/:invoiceId: full detail with line items + CQT code. */
  async getInvoiceDetail(
    customerId: string,
    invoiceId: string,
  ): Promise<InvoiceDetail> {
    this.validateInvoiceId(invoiceId);
    const result = await this.portRegistry.execute<InvoiceDetail>(
      'invoice',
      'get-by-id',
      { customerId, invoiceId },
    );
    return result.data;
  }

  /** AC#3 — GET /billing/invoices/:invoiceId/pdf: e-invoice PDF download URL. */
  async getInvoicePdf(
    customerId: string,
    invoiceId: string,
  ): Promise<InvoicePdf> {
    this.validateInvoiceId(invoiceId);
    const result = await this.portRegistry.execute<InvoicePdf>(
      'invoice',
      'get-pdf',
      { customerId, invoiceId },
    );
    return result.data;
  }

  // ── Tariff port ──────────────────────────────────────────────────────────────

  /** AC#1 — GET /billing/tariff/:contractId: tiered pricing table (bậc thang). */
  async getTariffPlan(
    customerId: string,
    contractId: string,
  ): Promise<TariffPlan> {
    this.validateContractId(contractId);
    const result = await this.portRegistry.execute<TariffPlan>(
      'tariff',
      'get-tariff-plan',
      { customerId, contractId },
    );
    return result.data;
  }

  /** AC#2 — GET /billing/tariff/:contractId/breakdown: invoice-specific tier breakdown. */
  async getTariffBreakdown(
    customerId: string,
    contractId: string,
    invoiceId: string,
  ): Promise<TariffBreakdown> {
    this.validateContractId(contractId);
    this.validateInvoiceId(invoiceId);
    const result = await this.portRegistry.execute<TariffBreakdown>(
      'tariff',
      'get-tariff-breakdown',
      { customerId, contractId, invoiceId },
    );
    return result.data;
  }

  /** AC#3 — GET /billing/tariff/:contractId/fees: environmental, drainage, VAT, surcharges. */
  async getApplicableFees(
    customerId: string,
    contractId: string,
  ): Promise<ApplicableFeesResponse> {
    this.validateContractId(contractId);
    const result = await this.portRegistry.execute<ApplicableFeesResponse>(
      'tariff',
      'get-applicable-fees',
      { customerId, contractId },
    );
    return result.data;
  }

  // ── Input validation (moved from old controllers) ────────────────────────────

  private validateInvoiceId(invoiceId: string): void {
    const parsed = InvoiceIdParamSchema.safeParse(invoiceId);
    if (!parsed.success) {
      throw new ValidationException('Invalid Invoice ID format');
    }
  }

  private validateContractId(contractId: string): void {
    const parsed = ContractIdParamSchema.safeParse(contractId);
    if (!parsed.success) {
      throw new ValidationException('Invalid Contract ID format');
    }
  }
}
