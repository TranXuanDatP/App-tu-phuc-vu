import { z } from 'zod';

/**
 * Session event DTOs + channel/event-type enums.
 * Consolidated from the former domain/events + application/dtos folders.
 */
export const SessionEventTypeSchema = z.enum([
  'zalo_message_received',
  'call_started',
  'call_completed',
  'ticket_created',
  'ticket_status_changed',
  'payment_completed',
  'payment_failed',
  'notification_sent',
  'invoice_viewed',
  'alert_acknowledged',
  'session_started',
  'session_continued',
]);
export type SessionEventType = z.infer<typeof SessionEventTypeSchema>;

export const ChannelTypeSchema = z.enum(['app', 'zalo', 'web', 'hotline', 'counter']);
export type ChannelType = z.infer<typeof ChannelTypeSchema>;

export const SessionEventSchema = z.object({
  id: z.string().uuid(),
  type: SessionEventTypeSchema,
  channel: ChannelTypeSchema,
  timestamp: z.string(),
  content: z.record(z.string(), z.unknown()),
});
export type SessionEvent = z.infer<typeof SessionEventSchema>;

export const SessionMetadataSchema = z.object({
  sessionId: z.string().uuid(),
  userId: z.string().min(1),
  channel: ChannelTypeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  eventCount: z.number().int().nonnegative(),
});
export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;

/**
 * Payload schema for recording a session event.
 * Kept for DTO-contract stability; the write handlers were dropped but the
 * shape is preserved in case writes are re-wired later.
 */
export const RecordSessionEventPayloadSchema = z.object({
  userId: z.string().min(1),
  eventType: SessionEventTypeSchema,
  channel: ChannelTypeSchema,
  content: z.record(z.string(), z.unknown()),
});
export type RecordSessionEventPayload = z.infer<typeof RecordSessionEventPayloadSchema>;
