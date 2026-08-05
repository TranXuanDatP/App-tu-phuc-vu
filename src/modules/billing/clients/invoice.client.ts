/**
 * Mock adapter for the invoice port (downstream Invoice/Billing service).
 *
 * STATEFUL + OWNER-SCOPED (A2 Layer-2, SPEC-A2 §D4): reads the raw invoice list
 * (mocks/invoice/get-list.json, which carries a server-side `ownerCustomerId` per
 * invoice) and enforces ownership — a bound customer sees ONLY their invoices, and
 * a get-by-id for another customer's invoice returns 404 (same shape as "not found",
 * no oracle). `ownerCustomerId` is stripped from the API response (it's a server-side
 * ownership mark, never exposed).
 *
 * This is the IDOR fix at the data layer: the BFF passes the BOUND customerId
 * (from @CustomerId, never client-supplied) and the mock scopes by it. When the real
 * downstream ships, ownership is enforced there by the same customerId — zero BFF
 * change. Swap to an InternalAdapterBase subclass when ready.
 */
import { Injectable, Logger } from '@nestjs/common';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import { NotFoundException } from '@core/common';
import {
  InvoiceListResponseSchema,
  InvoiceDetailSchema,
  InvoicePdfSchema,
} from '../dto/invoice.dto';

/** Raw list item — includes the server-side ownership mark. */
interface RawInvoiceItem {
  invoiceId: string;
  contractId: string;
  period: string;
  totalAmount: number;
  paymentStatus: string;
  issueDate: string;
  dueDate?: string;
  /** Server-side ownership (NOT exposed in the API response). */
  ownerCustomerId: string;
}

@Injectable()
export class MockInvoiceAdapter extends MockAdapterBase {
  /** Raw list (with ownership) cached after first read. */
  private rawCache?: { items: RawInvoiceItem[]; page: number; limit: number };

  constructor() {
    super(
      'invoice',
      {
        'get-list': InvoiceListResponseSchema,
        'get-by-id': InvoiceDetailSchema,
        'get-pdf': InvoicePdfSchema,
      },
      new Logger('invoice-mock-adapter'),
    );
  }

  override async execute(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (method === 'get-list') return this.getList(params);
    if (method === 'get-by-id') return this.getById(params);
    return super.execute(method, params); // get-pdf → fixture
  }

  /** Read the raw list once (with ownerCustomerId) — bypassing Zod stripping. */
  private async loadRaw(): Promise<{
    items: RawInvoiceItem[];
    page: number;
    limit: number;
  }> {
    if (this.rawCache) return this.rawCache;
    const filePath = path.resolve(
      process.cwd(),
      'mocks',
      'invoice',
      'get-list.json',
    );
    const raw = JSON.parse(
      await fsPromises.readFile(filePath, 'utf-8'),
    ) as {
      invoices?: RawInvoiceItem[];
      page?: number;
      limit?: number;
    };
    this.rawCache = {
      items: raw.invoices ?? [],
      page: raw.page ?? 1,
      limit: raw.limit ?? 10,
    };
    return this.rawCache;
  }

  /** get-list scoped to the bound customer (A2 Layer-2). */
  private async getList(params: Record<string, unknown>) {
    const { items, page, limit } = await this.loadRaw();
    const customerId = params.customerId as string | undefined;
    // No customerId = legacy/unscoped caller → return all (backward-compat).
    const owned = customerId
      ? items.filter((i) => i.ownerCustomerId === customerId)
      : items;
    const pageSize = Math.max(1, Number(params.limit ?? limit));
    const pageNum = Math.max(1, Number(params.page ?? page));
    const start = (pageNum - 1) * pageSize;
    const paged = owned.slice(start, start + pageSize);
    return {
      // strip the ownership mark from the response
      invoices: paged.map(({ ownerCustomerId: _o, ...rest }) => rest),
      totalCount: owned.length,
      page: pageNum,
      limit: pageSize,
      totalPages: Math.max(1, Math.ceil(owned.length / pageSize)),
    };
  }

  /** get-by-id: not found OR not owned by the bound customer → 404 (no oracle). */
  private async getById(params: Record<string, unknown>) {
    const invoiceId = params.invoiceId as string | undefined;
    const customerId = params.customerId as string | undefined;
    if (!invoiceId) return super.execute('get-by-id', params);
    const { items } = await this.loadRaw();
    const item = items.find((i) => i.invoiceId === invoiceId);
    // IDOR fix: identical 404 for "doesn't exist" and "not yours".
    if (!item || (customerId && item.ownerCustomerId !== customerId)) {
      throw new NotFoundException('Invoice not found', 'INVOICE_NOT_FOUND', {
        invoiceId,
      });
    }
    return this.buildDetail(item);
  }

  /**
   * Build an InvoiceDetail from a list item. Line items + fees are generated
   * (mock) — derived from totalAmount so the numbers add up.
   */
  private buildDetail(item: RawInvoiceItem) {
    const total = item.totalAmount;
    const vat = Math.round(total * 0.05);
    const environmental = Math.round(total * 0.1);
    const subtotal = total - vat - environmental;
    const unitPrice = 5920;
    const volume = Math.max(1, Math.round(subtotal / unitPrice));

    return {
      invoiceId: item.invoiceId,
      contractId: item.contractId,
      period: item.period,
      lineItems: [
        {
          description: 'Tiêu thụ nước sinh hoạt',
          volume,
          unitPrice,
          amount: subtotal,
        },
      ],
      fees: [
        { feeName: 'Phí bảo vệ môi trường (10%)', amount: environmental },
        { feeName: 'VAT (5%)', amount: vat },
      ],
      subtotal,
      totalAmount: total,
      paymentStatus: item.paymentStatus,
      cqtCode: `CQT-${item.invoiceId}`,
      lookupCode: `LK-${item.invoiceId.slice(-6)}`,
      issueDate: item.issueDate,
      dueDate: item.dueDate ?? null,
    };
  }
}
