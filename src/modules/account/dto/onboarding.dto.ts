/**
 * Onboarding DTOs — Zod Schemas + TypeScript Types
 *
 * Port-contract response shapes for the 'onboarding' port (new connection
 * signup workflow). Moved from modules/onboarding when it folded into account.
 * (BFF owns no business data; DTOs are port contracts.)
 */
import { z } from 'zod';

// ── Response / Port Contract ─────────────────────────────────────────────────

export const OnboardingStage = z.enum([
  'submitted',
  'site_survey',
  'contract',
  'installation',
  'meter_activation',
  'completed',
  'rejected',
]);

export const OnboardingStatusSchema = z.object({
  requestId: z.string(),
  customerId: z.string(),
  stage: OnboardingStage,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OnboardingStatus = z.infer<typeof OnboardingStatusSchema>;

export const CreateOnboardingResultSchema = z.object({
  requestId: z.string(),
  stage: z.enum(['submitted', 'site_survey']),
  createdAt: z.string(),
});
export type CreateOnboardingResult = z.infer<typeof CreateOnboardingResultSchema>;

export const SubmitDocumentsResultSchema = z.object({
  requestId: z.string(),
  stage: z.enum(['site_survey', 'contract']),
  uploadedDocumentKeys: z.array(z.string()),
  updatedAt: z.string(),
});
export type SubmitDocumentsResult = z.infer<typeof SubmitDocumentsResultSchema>;

// ── Request Validation (writes) ──────────────────────────────────────────────

export const CreateOnboardingRequestSchema = z.object({
  address: z.string().min(1),
  customerType: z.enum(['sinh_hoat', 'san_xuat', 'kcn']),
  documents: z.array(z.string()),
});
export type CreateOnboardingRequestDto = z.infer<typeof CreateOnboardingRequestSchema>;

export const SubmitDocumentsRequestSchema = z.object({
  documents: z.array(z.string()),
});
export type SubmitDocumentsRequestDto = z.infer<typeof SubmitDocumentsRequestSchema>;
