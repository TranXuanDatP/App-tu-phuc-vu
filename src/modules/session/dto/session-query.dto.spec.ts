import {
  SessionEventsQuerySchema,
  SessionEventsResponseSchema,
  SessionDetailResponseSchema,
} from './session-query.dto';

describe('Session Query DTOs', () => {
  // ── SessionEventsQuerySchema ─────────────────────────────────────────────────

  describe('SessionEventsQuerySchema', () => {
    it('should apply defaults for page and pageSize', () => {
      const result = SessionEventsQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.pageSize).toBe(20);
      }
    });

    it('should coerce string page/pageSize to numbers', () => {
      const result = SessionEventsQuerySchema.safeParse({ page: '2', pageSize: '10' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(2);
        expect(result.data.pageSize).toBe(10);
      }
    });

    it('should reject pageSize > 50', () => {
      const result = SessionEventsQuerySchema.safeParse({ page: 1, pageSize: 100 });
      expect(result.success).toBe(false);
    });

    it('should reject negative page', () => {
      const result = SessionEventsQuerySchema.safeParse({ page: -1 });
      expect(result.success).toBe(false);
    });

    it('should accept valid channel filter', () => {
      const result = SessionEventsQuerySchema.safeParse({ channel: 'zalo', page: 1, pageSize: 20 });
      expect(result.success).toBe(true);
    });

    it('should reject invalid channel', () => {
      const result = SessionEventsQuerySchema.safeParse({ channel: 'telegram' });
      expect(result.success).toBe(false);
    });

    it('should accept time range filters', () => {
      const result = SessionEventsQuerySchema.safeParse({ from: 1000, to: 2000 });
      expect(result.success).toBe(true);
    });
  });

  // ── SessionEventsResponseSchema ──────────────────────────────────────────────

  describe('SessionEventsResponseSchema', () => {
    const validResponse = {
      sessionId: '550e8400-e29b-41d4-a716-446655440001',
      events: [],
      totalCount: 0,
      page: 1,
      pageSize: 20,
    };

    it('should validate a valid response', () => {
      const result = SessionEventsResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });

    it('should accept null sessionId', () => {
      const result = SessionEventsResponseSchema.safeParse({ ...validResponse, sessionId: null });
      expect(result.success).toBe(true);
    });
  });

  // ── SessionDetailResponseSchema ─────────────────────────────────────────────

  describe('SessionDetailResponseSchema', () => {
    it('should validate response with null session and empty events', () => {
      const result = SessionDetailResponseSchema.safeParse({
        session: null,
        recentEvents: [],
      });
      expect(result.success).toBe(true);
    });
  });
});
