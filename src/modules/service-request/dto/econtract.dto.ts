/**
 * e-Contract DTOs — Zod Schemas + TypeScript Types
 *
 * Normalized response shapes for the econtract port (digital contract retrieval
 * + e-signature). Also holds the request body schema for POST /econtracts/:dossierId/sign.
 * (Moved from modules/econtract — BFF owns no business data, DTOs are port contracts.)
 */

import { z } from 'zod';

// ── e-Contract (get-contract) ────────────────────────────────────────────────

export const EcontractResponseSchema = z.object({
  dossierId: z.string(),
  customerId: z.string(),
  status: z.enum(['draft', 'pending_signature', 'signed', 'expired']),
  downloadUrl: z.string().nullable(),
  signedAt: z.string().nullable(),
});
export type EcontractResponse = z.infer<typeof EcontractResponseSchema>;

// ── Sign Contract (sign-contract) ────────────────────────────────────────────

export const SignContractResultSchema = z.object({
  dossierId: z.string(),
  status: z.enum(['signed', 'failed']),
  signedAt: z.string(),
});
export type SignContractResult = z.infer<typeof SignContractResultSchema>;

/**
 * Request body for POST /econtracts/:dossierId/sign — signatureRef is required.
 */
export const SignContractBodySchema = z.object({
  signatureRef: z.string().min(1),
});
export type SignContractBodyDto = z.infer<typeof SignContractBodySchema>;
