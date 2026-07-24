/**
 * Notification Dispatch DTOs — Zod Schemas + TypeScript Types
 *
 * AC#1: Rate Limiter Funnel (FR55)
 * AC#2: Channel Dispatch (FR54)
 * AC#3: Session Event Recording (stub)
 *
 * Central notification types for cross-module dispatch.
 * (Moved from modules/communication — BFF owns no business data, DTOs are port contracts.)
 */

import { z } from 'zod';

// =============================================================================
// AC#2: Channel & Type Enums
// =============================================================================

export const NotificationChannelSchema = z.enum(['zns', 'push', 'sms', 'email', 'in_app']);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const NotificationTypeSchema = z.enum([
  'payment_completed',
  'payment_failed',
  'ticket_status_changed',
  'alert_outage',
  'alert_maintenance',
  'alert_quality',
  'debt_reminder',
]);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

// =============================================================================
// AC#1, #2: Dispatch Payload
// =============================================================================

export const DispatchNotificationPayloadSchema = z.object({
  customerId: z.string().min(1),
  type: NotificationTypeSchema,
  channel: NotificationChannelSchema.optional(),
  isCritical: z.boolean().default(false),
  ticketId: z.string().optional(),
  invoiceId: z.string().optional(),
  amount: z.number().positive().optional(),
  trackingId: z.string().optional(),
  oldStatus: z.string().optional(),
  newStatus: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type DispatchNotificationPayload = z.infer<typeof DispatchNotificationPayloadSchema>;

// =============================================================================
// Dispatch Result
// =============================================================================

export const DispatchNotificationResultSchema = z.object({
  dispatched: z.boolean(),
  channel: NotificationChannelSchema,
  rateLimited: z.boolean(),
  fallbackChain: z.array(NotificationChannelSchema).optional(),
});
export type DispatchNotificationResult = z.infer<typeof DispatchNotificationResultSchema>;

// =============================================================================
// OTP delivery — auth delegates the OTP send to the notification port (lean BFF:
// auth doesn't send SMS directly). Real adapter calls the SMS/ZNS provider.
// =============================================================================

export const SendOtpResultSchema = z.object({ sent: z.boolean() });
export type SendOtpResult = z.infer<typeof SendOtpResultSchema>;
