import {
  SessionEventSchema,
  SessionMetadataSchema,
  RecordSessionEventPayloadSchema,
  SessionEventTypeSchema,
  ChannelTypeSchema,
} from './session-event.dto';

describe('Session Event DTOs', () => {
  // ── SessionEventTypeSchema ──────────────────────────────────────────────────

  describe('SessionEventTypeSchema', () => {
    it('should accept all valid event types', () => {
      const validTypes = [
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
      ];

      for (const type of validTypes) {
        expect(SessionEventTypeSchema.safeParse(type).success).toBe(true);
      }
    });

    it('should reject invalid event type', () => {
      const result = SessionEventTypeSchema.safeParse('invalid_event_type');
      expect(result.success).toBe(false);
    });
  });

  // ── ChannelTypeSchema ───────────────────────────────────────────────────────

  describe('ChannelTypeSchema', () => {
    it('should accept all valid channels', () => {
      const validChannels = ['zalo', 'web', 'hotline', 'counter', 'app'];

      for (const ch of validChannels) {
        expect(ChannelTypeSchema.safeParse(ch).success).toBe(true);
      }
    });

    it('should reject invalid channel', () => {
      const result = ChannelTypeSchema.safeParse('telegram');
      expect(result.success).toBe(false);
    });
  });

  // ── SessionEventSchema ──────────────────────────────────────────────────────

  describe('SessionEventSchema', () => {
    const validEvent = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'notification_sent',
      channel: 'zalo',
      timestamp: new Date().toISOString(),
      content: { key: 'value' },
    };

    it('should validate a valid session event', () => {
      const result = SessionEventSchema.safeParse(validEvent);
      expect(result.success).toBe(true);
    });

    it('should reject event without id', () => {
      const { id, ...noId } = validEvent;
      const result = SessionEventSchema.safeParse(noId);
      expect(result.success).toBe(false);
    });

    it('should reject event with non-UUID id', () => {
      const result = SessionEventSchema.safeParse({ ...validEvent, id: 'not-a-uuid' });
      expect(result.success).toBe(false);
    });

    it('should reject event with invalid type', () => {
      const result = SessionEventSchema.safeParse({ ...validEvent, type: 'unknown' });
      expect(result.success).toBe(false);
    });

    it('should reject event with invalid channel', () => {
      const result = SessionEventSchema.safeParse({ ...validEvent, channel: 'email' });
      expect(result.success).toBe(false);
    });

    it('should reject event without timestamp', () => {
      const { timestamp, ...noTs } = validEvent;
      const result = SessionEventSchema.safeParse(noTs);
      expect(result.success).toBe(false);
    });

    it('should reject event without content', () => {
      const { content, ...noContent } = validEvent;
      const result = SessionEventSchema.safeParse(noContent);
      expect(result.success).toBe(false);
    });
  });

  // ── SessionMetadataSchema ───────────────────────────────────────────────────

  describe('SessionMetadataSchema', () => {
    const validMetadata = {
      sessionId: '550e8400-e29b-41d4-a716-446655440001',
      userId: 'USR-12345',
      channel: 'web',
      createdAt: '2026-06-12T10:00:00Z',
      updatedAt: '2026-06-12T10:30:00Z',
      eventCount: 5,
    };

    it('should validate valid session metadata', () => {
      const result = SessionMetadataSchema.safeParse(validMetadata);
      expect(result.success).toBe(true);
    });

    it('should reject metadata with negative eventCount', () => {
      const result = SessionMetadataSchema.safeParse({ ...validMetadata, eventCount: -1 });
      expect(result.success).toBe(false);
    });

    it('should reject metadata with empty userId', () => {
      const result = SessionMetadataSchema.safeParse({ ...validMetadata, userId: '' });
      expect(result.success).toBe(false);
    });

    it('should reject metadata with non-integer eventCount', () => {
      const result = SessionMetadataSchema.safeParse({ ...validMetadata, eventCount: 1.5 });
      expect(result.success).toBe(false);
    });

    it('should accept zero eventCount', () => {
      const result = SessionMetadataSchema.safeParse({ ...validMetadata, eventCount: 0 });
      expect(result.success).toBe(true);
    });
  });

  // ── RecordSessionEventPayloadSchema ─────────────────────────────────────────

  describe('RecordSessionEventPayloadSchema', () => {
    const validPayload = {
      userId: 'USR-12345',
      eventType: 'notification_sent',
      channel: 'zalo',
      content: { notificationType: 'payment_completed' },
    };

    it('should validate a valid payload', () => {
      const result = RecordSessionEventPayloadSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it('should reject payload with empty userId', () => {
      const result = RecordSessionEventPayloadSchema.safeParse({ ...validPayload, userId: '' });
      expect(result.success).toBe(false);
    });

    it('should reject payload with invalid eventType', () => {
      const result = RecordSessionEventPayloadSchema.safeParse({ ...validPayload, eventType: 'unknown' });
      expect(result.success).toBe(false);
    });

    it('should reject payload with invalid channel', () => {
      const result = RecordSessionEventPayloadSchema.safeParse({ ...validPayload, channel: 'email' });
      expect(result.success).toBe(false);
    });

    it('should reject payload without content', () => {
      const { content, ...noContent } = validPayload;
      const result = RecordSessionEventPayloadSchema.safeParse(noContent);
      expect(result.success).toBe(false);
    });

    it('should accept empty content object', () => {
      const result = RecordSessionEventPayloadSchema.safeParse({ ...validPayload, content: {} });
      expect(result.success).toBe(true);
    });
  });
});
