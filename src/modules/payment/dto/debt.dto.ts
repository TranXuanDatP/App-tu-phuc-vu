/**
 * Debt DTOs — Zod Schemas + TypeScript Types
 *
 * AC#1: Outstanding Debt with aging buckets
 * AC#2: Debt History (chronological)
 * AC#3: Dynamic cache tier (5-15 min)
 */

import { z } from 'zod';

// =============================================================================
// AC#1: Outstanding Debt with Aging
// =============================================================================

export const AgingBucketSchema = z.enum(['current', '31-60', '61-90', '>90']);

export const DebtEntrySchema = z.object({
  invoiceRef: z.string().min(1),
  amount: z.number().positive(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  daysOverdue: z.number().int().nonnegative(),
  agingBucket: AgingBucketSchema,
});

export const AgingBreakdownSchema = z.object({
  current: z.number().nonnegative(),   // 0-30 days
  '31-60': z.number().nonnegative(),
  '61-90': z.number().nonnegative(),
  '>90': z.number().nonnegative(),
});

export const OutstandingDebtResponseSchema = z.object({
  totalAmount: z.number().nonnegative(),
  agingBreakdown: AgingBreakdownSchema,
  debts: z.array(DebtEntrySchema),
  totalCount: z.number(),
});

// =============================================================================
// AC#2: Debt History
// =============================================================================

export const DebtHistoryEntrySchema = z.object({
  invoiceRef: z.string().min(1),
  amount: z.number().nonnegative(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/).nullable(),
  status: z.enum(['outstanding', 'paid', 'written_off']),
  agingAtPayment: z.string().nullable(),
});

export const DebtHistoryResponseSchema = z.object({
  entries: z.array(DebtHistoryEntrySchema),
  totalCount: z.number(),
});

// =============================================================================
// TypeScript Types
// =============================================================================

export type AgingBucket = z.infer<typeof AgingBucketSchema>;
export type DebtEntry = z.infer<typeof DebtEntrySchema>;
export type AgingBreakdown = z.infer<typeof AgingBreakdownSchema>;
export type OutstandingDebtResponse = z.infer<typeof OutstandingDebtResponseSchema>;
export type DebtHistoryEntry = z.infer<typeof DebtHistoryEntrySchema>;
export type DebtHistoryResponse = z.infer<typeof DebtHistoryResponseSchema>;
