/**
 * Contract DTOs — Zod Schemas + TypeScript Types
 *
 * Normalized response shapes for the contract port.
 * AC: #1 (contract list), #2 (detail), #3 (versions), #4 (PDF)
 * (Moved from modules/contract — BFF owns no business data, DTOs are port contracts.)
 */

import { z } from 'zod';

// ── Contract List Item (AC#1) ────────────────────────────────────────────────

export const ContractListItemSchema = z.object({
  contractId: z.string(),
  address: z.string(),
  meterId: z.string().nullable(),
  waterQuota: z.number().nullable(),
  subscriptionType: z.enum(['residential', 'commercial', 'industrial', 'administrative']),
  status: z.enum(['active', 'expired', 'terminated']),
  startDate: z.string(),
  endDate: z.string().nullable(),
  pricingTerms: z.object({
    basePrice: z.number(),
    currency: z.string(),
    billingCycle: z.string(),
  }).nullable(),
});

export const ContractListResponseSchema = z.object({
  contracts: z.array(ContractListItemSchema),
  totalCount: z.number(),
});

export type ContractListItem = z.infer<typeof ContractListItemSchema>;
export type ContractListResponse = z.infer<typeof ContractListResponseSchema>;

// ── Contract Detail (AC#2) ───────────────────────────────────────────────────

export const ContractDetailResponseSchema = z.object({
  contractId: z.string(),
  address: z.string(),
  meterId: z.string().nullable(),
  waterQuota: z.number().nullable(),
  subscriptionType: z.enum(['residential', 'commercial', 'industrial', 'administrative']),
  status: z.enum(['active', 'expired', 'terminated']),
  startDate: z.string(),
  endDate: z.string().nullable(),
  pricingTerms: z.object({
    basePrice: z.number(),
    currency: z.string(),
    billingCycle: z.string(),
  }),
  specialConditions: z.array(z.string()).nullable(),
});

export type ContractDetailResponse = z.infer<typeof ContractDetailResponseSchema>;

// ── Contract Versions (AC#3) ─────────────────────────────────────────────────

export const ContractVersionSchema = z.object({
  versionId: z.string(),
  versionNumber: z.number(),
  changeDescription: z.string(),
  effectiveDate: z.string(),
  changedBy: z.string(),
});

export const ContractVersionsResponseSchema = z.object({
  versions: z.array(ContractVersionSchema),
  totalCount: z.number(),
});

export type ContractVersion = z.infer<typeof ContractVersionSchema>;
export type ContractVersionsResponse = z.infer<typeof ContractVersionsResponseSchema>;

// ── Contract PDF (AC#4) ──────────────────────────────────────────────────────

export const ContractPDFResponseSchema = z.object({
  contractId: z.string(),
  downloadUrl: z.string(),
  fileName: z.string(),
  expiresAt: z.string().nullable(),
});

export type ContractPDFResponse = z.infer<typeof ContractPDFResponseSchema>;
