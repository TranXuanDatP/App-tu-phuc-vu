/**
 * Meter DTOs — Zod Schemas + TypeScript Types
 *
 * AC#1: Meter list (1:N — customer can have multiple meters)
 * AC#2: Calibration status (includes BFF-computed isWarning)
 * AC#3: Meter replacement history
 */

import { z } from 'zod';

// =============================================================================
// AC#1: Meter Info (single entry) + List Response (1:N)
// =============================================================================

export const MeterInfoSchema = z.object({
  meterId: z.string(),
  serialNumber: z.string(),
  type: z.enum(['mechanical', 'ultrasonic', 'electromagnetic']),
  diameter: z.string(), // e.g. "DN15", "DN20"
  accuracyClass: z.string(), // e.g. "Class B", "Class C"
  manufactureYear: z.number().int().min(1990),
  installationDate: z.string(),
  status: z.enum(['active', 'removed', 'defective']),
});

/** Meter LIST response — array wrapper for 1:N relationship */
export const MeterListResponseSchema = z.object({
  meters: z.array(MeterInfoSchema),
  totalCount: z.number(),
});

// =============================================================================
// AC#2: Calibration Status
// =============================================================================

/** Raw downstream response — does NOT include isWarning (BFF-computed in handler) */
export const CalibrationStatusRawSchema = z.object({
  meterId: z.string(),
  status: z.enum(['valid', 'expiring_soon', 'expired']),
  lastCalibrationDate: z.string(),
  nextCalibrationDate: z.string(),
  certificateNumber: z.string().nullable(),
});

/** Full response with BFF-computed isWarning flag */
export const CalibrationStatusResponseSchema = CalibrationStatusRawSchema.extend({
  isWarning: z.boolean(),
});

// =============================================================================
// AC#3: Meter Replacement History
// =============================================================================

export const MeterHistoryEntrySchema = z.object({
  eventDate: z.string(),
  eventType: z.enum(['installation', 'removal', 'replacement', 'calibration']),
  description: z.string(),
  performedBy: z.string(),
});

export const MeterHistoryResponseSchema = z.object({
  entries: z.array(MeterHistoryEntrySchema),
  totalCount: z.number(),
});

// =============================================================================
// Input Validation
// =============================================================================

/** meterId param validation — allows dashes + underscores for IoT/device IDs */
export const MeterIdParamSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9-_]+$/, 'Invalid Meter ID format');

// =============================================================================
// TypeScript Types
// =============================================================================

export type MeterInfo = z.infer<typeof MeterInfoSchema>;
export type MeterListResponse = z.infer<typeof MeterListResponseSchema>;
export type CalibrationStatusRaw = z.infer<typeof CalibrationStatusRawSchema>;
export type CalibrationStatusResponse = z.infer<typeof CalibrationStatusResponseSchema>;
export type MeterHistoryEntry = z.infer<typeof MeterHistoryEntrySchema>;
export type MeterHistoryResponse = z.infer<typeof MeterHistoryResponseSchema>;
