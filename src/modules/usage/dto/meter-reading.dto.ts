/**
 * Meter Reading DTOs — Zod Schemas + TypeScript Types
 *
 * Consumption history, comparison, and reading detail for chart rendering.
 * AC: #1 (readings), #2 (comparison), #3 (detail)
 */

import { z } from 'zod';

// =============================================================================
// AC#1: Consumption Readings (12 months for chart)
// =============================================================================

export const ConsumptionReadingSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Invalid month format'),
  volume: z.number().nonnegative(),
  readingDate: z.string(),
});

export const ReadingsListResponseSchema = z.object({
  readings: z.array(ConsumptionReadingSchema),
  totalCount: z.number(),
});

// =============================================================================
// AC#2: Consumption Comparison — raw downstream data
// NOTE: percentageChange + direction are BFF-computed in handler, NOT in schema
// =============================================================================

export const ComparisonRawSchema = z.object({
  currentPeriod: z.string(),
  previousPeriod: z.string(),
  currentVolume: z.number().nonnegative(),
  previousVolume: z.number().nonnegative(),
});

export const ComparisonResponseSchema = ComparisonRawSchema.extend({
  percentageChange: z.number().nullable(),
  direction: z.enum(['up', 'down', 'neutral']),
});

// =============================================================================
// AC#3: Period Reading Detail
// =============================================================================

export const EvidencePhotoSchema = z.object({
  url: z.string().url(),
  caption: z.string().optional(),
  takenAt: z.string().optional(),
});

export const ReadingDetailSchema = z.object({
  period: z.string(),
  previousIndex: z.number().nonnegative(),
  currentIndex: z.number().nonnegative(),
  volume: z.number().nonnegative(),
  evidencePhotos: z.array(EvidencePhotoSchema),
});

// =============================================================================
// Input Validation
// =============================================================================

/** Period param — YYYY-MM format */
export const PeriodParamSchema = z.string().regex(/^\d{4}-\d{2}$/, 'Invalid period format. Use YYYY-MM');

/** Comparison query params */
export const ComparisonQuerySchema = z.object({
  current: z.string().regex(/^\d{4}-\d{2}$/, 'Invalid current period'),
  previous: z.string().regex(/^\d{4}-\d{2}$/, 'Invalid previous period'),
});

// =============================================================================
// TypeScript Types
// =============================================================================

export type ConsumptionReading = z.infer<typeof ConsumptionReadingSchema>;
export type ReadingsListResponse = z.infer<typeof ReadingsListResponseSchema>;
export type ComparisonRaw = z.infer<typeof ComparisonRawSchema>;
export type ComparisonResponse = z.infer<typeof ComparisonResponseSchema>;
export type EvidencePhoto = z.infer<typeof EvidencePhotoSchema>;
export type ReadingDetail = z.infer<typeof ReadingDetailSchema>;
