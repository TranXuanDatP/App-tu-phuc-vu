import { SessionService } from './session.service';
import { ValidationException } from '@core/common';
import type { SessionMetadata } from './dto/session-event.dto';

describe('SessionService', () => {
  let service: SessionService;
  let sessionStore: {
    getSession: jest.Mock;
    getEvents: jest.Mock;
    appendEvent: jest.Mock;
    sessionExists: jest.Mock;
  };

  const TEST_USER_ID = 'USR-SESSION-001';

  const mockMetadata: SessionMetadata = {
    sessionId: '550e8400-e29b-41d4-a716-446655440000',
    userId: TEST_USER_ID,
    channel: 'web',
    createdAt: '2026-07-15T10:00:00.000Z',
    updatedAt: '2026-07-15T10:30:00.000Z',
    eventCount: 3,
  };

  beforeEach(() => {
    sessionStore = {
      getSession: jest.fn(),
      getEvents: jest.fn(),
      appendEvent: jest.fn(),
      sessionExists: jest.fn(),
    };
    service = new SessionService(sessionStore as any);
  });

  describe('getMySession', () => {
    it('returns session metadata + recent events when session exists', async () => {
      const recentEvents = [
        { id: 'evt-1', type: 'notification_sent', channel: 'web', timestamp: new Date().toISOString(), content: {} },
      ];
      sessionStore.getSession.mockResolvedValue(mockMetadata);
      sessionStore.getEvents.mockResolvedValue(recentEvents);

      const result = await service.getMySession(TEST_USER_ID);

      expect(sessionStore.getSession).toHaveBeenCalledWith(TEST_USER_ID);
      // recent-events window starts ~2h ago
      expect(sessionStore.getEvents).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.any(Number),
      );
      expect(result).toEqual({ session: mockMetadata, recentEvents });
    });

    it('returns null session + empty events when session missing', async () => {
      sessionStore.getSession.mockResolvedValue(null);

      const result = await service.getMySession(TEST_USER_ID);

      expect(sessionStore.getEvents).not.toHaveBeenCalled();
      expect(result).toEqual({ session: null, recentEvents: [] });
    });
  });

  describe('getMyEvents', () => {
    it('validates query, reads store, paginates and filters by channel', async () => {
      const events = [
        { id: 'evt-1', type: 'ticket_created', channel: 'zalo', timestamp: '2026-07-15T10:00:00.000Z', content: {} },
        { id: 'evt-2', type: 'call_started', channel: 'web', timestamp: '2026-07-15T10:01:00.000Z', content: {} },
        { id: 'evt-3', type: 'call_completed', channel: 'web', timestamp: '2026-07-15T10:02:00.000Z', content: {} },
      ];
      sessionStore.getSession.mockResolvedValue(mockMetadata);
      sessionStore.getEvents.mockResolvedValue(events);

      const result = await service.getMyEvents(TEST_USER_ID, {
        channel: 'web',
        page: 1,
        pageSize: 10,
      });

      // secondary channel filter keeps only the 2 web events
      expect(result).toEqual({
        sessionId: mockMetadata.sessionId,
        events: [events[1], events[2]],
        totalCount: 2,
        page: 1,
        pageSize: 10,
      });
    });

    it('applies defaults for page/pageSize when omitted', async () => {
      sessionStore.getSession.mockResolvedValue(null);
      sessionStore.getEvents.mockResolvedValue([]);

      const result = await service.getMyEvents(TEST_USER_ID, {});

      expect(result).toEqual({
        sessionId: null,
        events: [],
        totalCount: 0,
        page: 1,
        pageSize: 20,
      });
    });

    it('paginates beyond the first page', async () => {
      const events = Array.from({ length: 25 }, (_, i) => ({
        id: `evt-${i}`,
        type: 'invoice_viewed',
        channel: 'app',
        timestamp: `2026-07-15T10:${String(i).padStart(2, '0')}:00.000Z`,
        content: {},
      }));
      sessionStore.getSession.mockResolvedValue(mockMetadata);
      sessionStore.getEvents.mockResolvedValue(events);

      const result = await service.getMyEvents(TEST_USER_ID, { page: 2, pageSize: 20 });

      expect(result.totalCount).toBe(25);
      expect(result.events).toHaveLength(5);
      expect(result.page).toBe(2);
    });

    it('throws ValidationException for pageSize > 50', async () => {
      await expect(
        service.getMyEvents(TEST_USER_ID, { pageSize: 999 }),
      ).rejects.toThrow(ValidationException);
    });

    it('throws ValidationException for invalid channel', async () => {
      await expect(
        service.getMyEvents(TEST_USER_ID, { channel: 'telegram' }),
      ).rejects.toThrow(ValidationException);
    });

    it('passes time-range filters through to the store', async () => {
      sessionStore.getSession.mockResolvedValue(null);
      sessionStore.getEvents.mockResolvedValue([]);

      await service.getMyEvents(TEST_USER_ID, { from: 1000, to: 2000 });

      expect(sessionStore.getEvents).toHaveBeenCalledWith(TEST_USER_ID, 1000, 2000);
    });
  });
});
