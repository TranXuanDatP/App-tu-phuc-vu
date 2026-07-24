/**
 * Payment DTOs — Zod Schemas + TypeScript Types
 *
 * AC#1: Create Payment Request (controller input)
 * AC#1: Create Payment Response (port response)
 * AC#2: Transaction tier — NO CACHING
 * AC#4: Idempotency key auto-injected by PortRegistry
 *
 * Story 4.2: Payment Webhook Payload (inbound from Payment Service)
 */

import { z } from 'zod';

// =============================================================================
// Payment Method Enum
// =============================================================================

export const PaymentMethodSchema = z.enum(['qr_code', 'payment_link', 'bank_transfer']);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

// =============================================================================
// Input Validation — Invoice ID param (reused from billing module pattern)
// =============================================================================

export const InvoiceIdParamSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9-_]+$/, 'Invalid Invoice ID format');

// =============================================================================
// AC#1: Create Payment Request (controller input)
// =============================================================================

export const CreatePaymentRequestSchema = z.object({
  invoiceId: InvoiceIdParamSchema,
  method: PaymentMethodSchema,
});

// =============================================================================
// AC#1: Create Payment Response (port response)
// =============================================================================

export const CreatePaymentResponseSchema = z.object({
  paymentId: z.string(),
  invoiceId: z.string(),
  amount: z.number().positive(),
  method: PaymentMethodSchema,
  qrCodeUrl: z.string().url().nullable(), // Present when method = qr_code
  paymentLink: z.string().url().nullable(), // Present when method = payment_link
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  expiresAt: z.string(), // ISO timestamp — payment link/QR expiry
  createdAt: z.string(),
});

// =============================================================================
// Story 4.2 — AC#1: Payment Webhook Payload (inbound from Payment Service)
// =============================================================================

export const PaymentWebhookStatusSchema = z.enum(['success', 'failed']);
export type PaymentWebhookStatus = z.infer<typeof PaymentWebhookStatusSchema>;

export const PaymentWebhookPayloadSchema = z.object({
  paymentId: z.string(),
  invoiceId: z.string(),
  customerId: z.string(),
  amount: z.number().positive(),
  status: PaymentWebhookStatusSchema,
  timestamp: z.string(),
});
export type PaymentWebhookPayload = z.infer<typeof PaymentWebhookPayloadSchema>;

// =============================================================================
// TypeScript Types
// =============================================================================

export type CreatePaymentRequest = z.infer<typeof CreatePaymentRequestSchema>;
export type CreatePaymentResponse = z.infer<typeof CreatePaymentResponseSchema>;

// =============================================================================
// Story 4.3 — AC#1: Payment History (paginated)
// =============================================================================

export const PaymentHistoryItemSchema = z.object({
  paymentId: z.string(),
  invoiceIds: z.array(z.string()),
  amount: z.number().nonnegative(),
  method: PaymentMethodSchema,
  status: z.enum(['completed', 'pending', 'failed', 'refunded']),
  createdAt: z.string(),
});

export const PaymentHistoryResponseSchema = z.object({
  payments: z.array(PaymentHistoryItemSchema),
  totalCount: z.number(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number(),
});

// =============================================================================
// Story 4.3 — AC#2: Batch Payment Request (controller input)
// =============================================================================

export const CreateBatchPaymentRequestSchema = z.object({
  invoiceIds: z.array(z.string().min(1).max(100).regex(/^[a-zA-Z0-9-_]+$/)).min(1).max(20),
  method: PaymentMethodSchema,
});

// =============================================================================
// Story 4.3 — AC#2: Batch Payment Response (port response)
// =============================================================================

export const CreateBatchPaymentResponseSchema = z.object({
  paymentId: z.string(),
  invoiceIds: z.array(z.string()),
  totalAmount: z.number().positive(),
  method: PaymentMethodSchema,
  qrCodeUrl: z.string().url().nullable(),
  paymentLink: z.string().url().nullable(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  expiresAt: z.string(),
  createdAt: z.string(),
});

// =============================================================================
// Story 4.3 — AC#1: Payment History Query Params
// =============================================================================

export const PaymentHistoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  status: z.enum(['completed', 'pending', 'failed']).optional(),
});

// =============================================================================
// Story 4.3 — TypeScript Types
// =============================================================================

export type PaymentHistoryItem = z.infer<typeof PaymentHistoryItemSchema>;
export type PaymentHistoryResponse = z.infer<typeof PaymentHistoryResponseSchema>;
export type CreateBatchPaymentRequest = z.infer<typeof CreateBatchPaymentRequestSchema>;
export type CreateBatchPaymentResponse = z.infer<typeof CreateBatchPaymentResponseSchema>;

// =============================================================================
// Story 4.4 — AC#1: Auto Debit Registration
// =============================================================================

export const BankAccountSchema = z.object({
  bankName: z.string().min(1).max(200),
  accountNumber: z.string().regex(/^[0-9]{6,20}$/, 'Invalid account number format'),
  accountHolder: z.string().min(1).max(200),
  branchCode: z.string().optional(),
});

export const SetupAutoDebitRequestSchema = z.object({
  bankAccount: BankAccountSchema,
});

export const AutoDebitStatusSchema = z.enum(['pending_verification', 'active', 'rejected', 'cancelled']);

export const SetupAutoDebitResponseSchema = z.object({
  registrationId: z.string(),
  status: AutoDebitStatusSchema,
  registeredAt: z.string(),
});

// =============================================================================
// Story 4.4 — TypeScript Types
// =============================================================================

export type BankAccount = z.infer<typeof BankAccountSchema>;
export type SetupAutoDebitRequest = z.infer<typeof SetupAutoDebitRequestSchema>;
export type AutoDebitStatus = z.infer<typeof AutoDebitStatusSchema>;
export type SetupAutoDebitResponse = z.infer<typeof SetupAutoDebitResponseSchema>;
