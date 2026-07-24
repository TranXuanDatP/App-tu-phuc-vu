/**
 * Invoice DTOs — Zod Schemas + TypeScript Types
 *
 * AC#1: Invoice List (paginated with filters)
 * AC#2: Invoice Detail (full breakdown with line items + CQT code)
 * AC#3: Invoice PDF (e-invoice compliant with Nghị định 123/2020/NĐ-CP)
 */

import { z } from 'zod';

// =============================================================================
// Shared: Payment Status
// =============================================================================

export const PaymentStatusSchema = z.enum(['paid', 'unpaid', 'overdue', 'cancelled']);

// =============================================================================
// AC#1: Invoice List (paginated)
// =============================================================================

export const InvoiceListItemSchema = z.object({
  invoiceId: z.string(),
  contractId: z.string(),
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Invalid period format'), // "2025-06"
  totalAmount: z.number().nonnegative(),
  paymentStatus: PaymentStatusSchema,
  issueDate: z.string(),
  dueDate: z.string().optional(),
});

export const InvoiceListResponseSchema = z.object({
  invoices: z.array(InvoiceListItemSchema),
  totalCount: z.number(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number(),
});

// =============================================================================
// AC#2: Invoice Detail (full breakdown)
// =============================================================================

export const InvoiceLineItemSchema = z.object({
  description: z.string(),
  volume: z.number().nonnegative(), // m³
  unitPrice: z.number().nonnegative(), // VND per m³ or fixed
  amount: z.number().nonnegative(), // line total
});

export const InvoiceDetailSchema = z.object({
  invoiceId: z.string(),
  contractId: z.string(),
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Invalid period format'),
  lineItems: z.array(InvoiceLineItemSchema),
  subtotal: z.number().nonnegative(),
  fees: z.array(z.object({
    feeName: z.string(),
    amount: z.number().nonnegative(),
  })),
  totalAmount: z.number().nonnegative(),
  paymentStatus: PaymentStatusSchema,
  cqtCode: z.string().nullable(), // CQT mã tra cứu
  lookupCode: z.string().nullable(), // Mã tra cứu hóa đơn điện tử
  issueDate: z.string(),
  dueDate: z.string().optional(),
});

// =============================================================================
// AC#3: Invoice PDF
// =============================================================================

export const InvoicePdfSchema = z.object({
  invoiceId: z.string(),
  pdfUrl: z.string().url(),
  cqtCode: z.string(),
  lookupCode: z.string(),
  digitalSignature: z.string().min(10), // Base64 or URL — reject trivially short values
});

// =============================================================================
// Input Validation
// =============================================================================

export const InvoiceIdParamSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9-_]+$/, 'Invalid Invoice ID format');

export const InvoiceStatusFilterSchema = z.enum(['paid', 'unpaid', 'overdue']).optional();

export const InvoiceListQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Invalid month format. Use YYYY-MM').optional(),
  status: InvoiceStatusFilterSchema,
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
});

// =============================================================================
// TypeScript Types
// =============================================================================

export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;
export type InvoiceListItem = z.infer<typeof InvoiceListItemSchema>;
export type InvoiceListResponse = z.infer<typeof InvoiceListResponseSchema>;
export type InvoiceLineItem = z.infer<typeof InvoiceLineItemSchema>;
export type InvoiceDetail = z.infer<typeof InvoiceDetailSchema>;
export type InvoicePdf = z.infer<typeof InvoicePdfSchema>;
