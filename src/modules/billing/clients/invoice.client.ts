/**
 * Mock adapter for the invoice port (downstream Invoice/Billing service).
 * Reads mocks/invoice/<method>.json. Swap to a real InternalAdapterBase
 * subclass (passed as the 2nd arg of portRegistry.register) when the downstream
 * service is ready — flip config/api-endpoints.yaml `adapter: live`.
 *
 * Methods: get-list, get-by-id, get-pdf
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
}
