/**
 * Smart Meter DTOs — Zod Schemas + TypeScript Types
 *
 * Real-time consumption + device status (Phase 2, S18).
 * Folded from the former smart-meter module; port name + shapes preserved.
 */

import { z } from 'zod';

export const RealtimeConsumptionSchema = z.object({
  customerId: z.string(),
  meterId: z.string(),
  currentFlowM3h: z.number(),
  todayM3: z.number(),
  lastReadingAt: z.string(),
});
export type RealtimeConsumption = z.infer<typeof RealtimeConsumptionSchema>;

export const SmartMeterStatusSchema = z.object({
  meterId: z.string(),
  online: z.boolean(),
  batteryLevel: z.number(),
  lastSeenAt: z.string(),
});
export type SmartMeterStatus = z.infer<typeof SmartMeterStatusSchema>;
