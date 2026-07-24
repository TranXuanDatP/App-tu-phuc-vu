/**
 * Contract Query DTOs — Zod Schema + TypeScript Type
 *
 * Query filter schemas for GET /contracts endpoint.
 * Also includes contractId param validation for detail/versions/pdf endpoints.
 * (Moved from modules/contract — BFF owns no business data, DTOs are port contracts.)
 */

import { z } from 'zod';

export const ContractQuerySchema = z.object({
  status: z.enum(['active', 'expired', 'terminated']).optional(),
}).optional();

export type ContractQueryDto = z.infer<typeof ContractQuerySchema>;

/**
 * ContractId param validation — alphanumeric, dashes, underscores only.
 */
export const ContractIdParamSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
