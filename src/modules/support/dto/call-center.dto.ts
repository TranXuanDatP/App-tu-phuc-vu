/**
 * Call Center DTOs — Zod Schemas + TypeScript Types
 *
 * Response shapes for the call-center port (port name preserved).
 * (Moved from modules/call-center/application/dtos — BFF owns no business
 * data, DTOs are port contracts.)
 */
import { z } from 'zod';

// ── Click-to-Call Result ────────────────────────────────────────────────────

export const ClickToCallResultSchema = z.object({
  callId: z.string(),
  status: z.enum(['initiated', 'connecting', 'failed']),
  phoneNumber: z.string(),
});
export type ClickToCallResult = z.infer<typeof ClickToCallResultSchema>;

// ── Call History ────────────────────────────────────────────────────────────

export const CallHistorySchema = z.object({
  customerId: z.string(),
  calls: z.array(
    z.object({
      callId: z.string(),
      startedAt: z.string(),
      durationSec: z.number().int().nonnegative(),
      outcome: z.enum(['completed', 'missed', 'voicemail']),
    }),
  ),
});
export type CallHistory = z.infer<typeof CallHistorySchema>;
