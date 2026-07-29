/**
 * Mock adapter for the invoice port (downstream Invoice/Billing service).
 *
 * STATEFUL get-by-id: reads the invoice list (mocks/invoice/get-list.json) +
 * builds a per-invoice detail for the requested invoiceId — so tapping different
 * invoices in the app shows the CORRECT period/status/amount, not the same fixture
 * for all. get-list + get-pdf still use the generic MockAdapterBase file read.
 *
 * Swap to a real InternalAdapterBase subclass when the downstream service is ready.
 */
import { Injectable, Logger } from '@nestjs/common';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import {
  InvoiceListResponseSchema,
  InvoiceDetailSchema,
  InvoicePdfSchema,
} from '../dto/invoice.dto';

@Injectable()
export class MockInvoiceAdapter extends MockAdapterBase {
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
    if (method === 'get-by-id') {
      const invoiceId = params.invoiceId as string | undefined;
      if (invoiceId) {
        // Find the invoice in the list + build a detail for it.
        const listResult = (await super.execute('get-list', {})) as {
          invoices?: Array<{
            invoiceId: string;
            contractId: string;
            period: string;
            totalAmount: number;
            paymentStatus: string;
            issueDate: string;
            dueDate?: string;
          }>;
        };
        const item = listResult?.invoices?.find((i) => i.invoiceId === invoiceId);
        if (item) return this.buildDetail(item);
      }
    }
    return super.execute(method, params); // fallback to fixture
  }

  /**
   * Build an InvoiceDetail from a list item. Line items + fees are generated
   * (mock) — derived from totalAmount so the numbers add up.
   */
  private buildDetail(item: {
    invoiceId: string;
    contractId: string;
    period: string;
    totalAmount: number;
    paymentStatus: string;
    issueDate: string;
    dueDate?: string;
  }) {
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
