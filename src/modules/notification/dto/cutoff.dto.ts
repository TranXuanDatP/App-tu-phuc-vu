import { z } from 'zod';

/**
 * Cutoff schemas — migrated from the deleted water-cutoff module.
 * Customer reads cutoff schedules via notification (the cutoff OPERATION is ops-only).
 */
export const CutoffStatusSchema = z.object({
  customerId: z.string(),
  hasActiveCutoff: z.boolean(),
  reason: z.string().nullable(),
  scheduledAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
});
export type CutoffStatus = z.infer<typeof CutoffStatusSchema>;

export const CutoffScheduleSchema = z.object({
  areaId: z.string(),
  schedules: z.array(z.object({ from: z.string(), to: z.string(), reason: z.string() })),
});
export type CutoffSchedule = z.infer<typeof CutoffScheduleSchema>;
