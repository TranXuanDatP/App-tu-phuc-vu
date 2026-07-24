/**
 * Notification Preferences & History DTOs — Zod Schemas + TypeScript Types
 *
 * AC#1: Get Notification Preferences (FR56)
 * AC#2: Update Notification Preferences (FR56)
 * AC#3: Get Notification History (FR57)
 * AC#4: Cache Strategy (dynamic tier — 300s TTL)
 *
 * Reuses NotificationChannelSchema and NotificationTypeSchema from notification.dto.
 * (Moved from modules/communication — BFF owns no business data, DTOs are port contracts.)
 */

import { z } from 'zod';
import { NotificationChannelSchema, NotificationTypeSchema } from './notification.dto';

// =============================================================================
// AC#1: Notification Preferences
// =============================================================================

export const NotificationChannelPreferenceSchema = z.object({
  channel: NotificationChannelSchema,
  enabled: z.boolean(),
  isCritical: z.boolean().describe('If true, this channel cannot be disabled by the customer'),
});
export type NotificationChannelPreference = z.infer<typeof NotificationChannelPreferenceSchema>;

export const NotificationPreferencesResponseSchema = z.object({
  customerId: z.string().min(1),
  channels: z.array(NotificationChannelPreferenceSchema),
  updatedAt: z.string(),
});
export type NotificationPreferencesResponse = z.infer<typeof NotificationPreferencesResponseSchema>;

// =============================================================================
// AC#2: Update Notification Preferences
// =============================================================================

export const UpdateNotificationPreferencesPayloadSchema = z.object({
  channels: z.array(z.object({
    channel: NotificationChannelSchema,
    enabled: z.boolean(),
  })).min(1),
});
export type UpdateNotificationPreferencesPayload = z.infer<typeof UpdateNotificationPreferencesPayloadSchema>;

export const UpdateNotificationPreferencesResponseSchema = NotificationPreferencesResponseSchema;
export type UpdateNotificationPreferencesResponse = z.infer<typeof UpdateNotificationPreferencesResponseSchema>;

// =============================================================================
// AC#3: Notification History
// =============================================================================

export const NotificationDeliveryStatusSchema = z.enum(['sent', 'delivered', 'failed']);
export type NotificationDeliveryStatus = z.infer<typeof NotificationDeliveryStatusSchema>;

export const NotificationHistoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(20),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  channel: NotificationChannelSchema.optional(),
  type: NotificationTypeSchema.optional(),
}).refine(
  (data) => {
    if (data.startDate && data.endDate) {
      return data.startDate <= data.endDate;
    }
    return true;
  },
  { message: 'startDate must be before or equal to endDate' },
);
export type NotificationHistoryQuery = z.infer<typeof NotificationHistoryQuerySchema>;

export const NotificationHistoryItemSchema = z.object({
  id: z.string().min(1),
  type: NotificationTypeSchema,
  channel: NotificationChannelSchema,
  contentSummary: z.string().min(1),
  timestamp: z.string(),
  deliveryStatus: NotificationDeliveryStatusSchema,
});
export type NotificationHistoryItem = z.infer<typeof NotificationHistoryItemSchema>;

export const NotificationHistoryResponseSchema = z.object({
  notifications: z.array(NotificationHistoryItemSchema),
  totalCount: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
export type NotificationHistoryResponse = z.infer<typeof NotificationHistoryResponseSchema>;

// =============================================================================
// Shared Validation
// =============================================================================

export const UpdatePreferencesBodySchema = UpdateNotificationPreferencesPayloadSchema;
