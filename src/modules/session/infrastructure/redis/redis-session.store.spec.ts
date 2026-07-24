import { RedisSessionStore } from './redis-session.store';
import { SESSION_TTL_TOKEN } from '../../constants/tokens';
import { CACHE_SERVICE_TOKEN } from '@core/constants/tokens';

// The store inlines its Lua append script (no fs read at runtime), so the spec
// asserts on a stable substring of that inlined script rather than a mock value.

// Mock crypto for randomUUID (sessionId generation in appendEvent)
jest.mock('crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('mock-uuid-session-id'),
}));

// Mock Lua script SHA
const MOCK_SHA = 'abc123mocksha';

function createMockRedisClient() {
  return {
    scriptLoad: jest.fn().mockResolvedValue(MOCK_SHA),
    evalSha: jest.fn().mockResolvedValue(1),
    eval: jest.fn().mockResolvedValue(1),
    hGetAll: jest.fn().mockResolvedValue({}),
    zRange: jest.fn().mockResolvedValue([]),
    zRangeByScore: jest.fn().mockResolvedValue([]),
    exists: jest.fn().mockResolvedValue(0),
  };
}

function createMockCacheService(client: ReturnType<typeof createMockRedisClient>) {
  return {
    getClient: jest.fn().mockReturnValue(client),
  };
}

describe('RedisSessionStore', () => {
  let store: RedisSessionStore;
  let mockClient: ReturnType<typeof createMockRedisClient>;
  let mockCacheService: ReturnType<typeof createMockCacheService>;

  const defaultTtl = 86400;

  const mockEvent = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    type: 'notification_sent' as const,
    channel: 'zalo' as const,
    timestamp: new Date().toISOString(),
    content: { notificationType: 'payment_completed' },
  };

  beforeEach(() => {
    mockClient = createMockRedisClient();
    mockCacheService = createMockCacheService(mockClient);
    store = new RedisSessionStore(
      mockCacheService as any,
      defaultTtl,
    );
  });

  // ── onModuleInit ──────────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('should load the inlined Lua script and store SHA', async () => {
      await store.onModuleInit();

      expect(mockClient.scriptLoad).toHaveBeenCalledWith(expect.stringContaining('redis.call'));
    });
  });

  // ── appendEvent ──────────────────────────────────────────────────────────────

  describe('appendEvent', () => {
    beforeEach(async () => {
      await store.onModuleInit();
    });

    it('should call EVALSHA with correct keys and arguments including session init fields', async () => {
      await store.appendEvent('USR-12345', mockEvent);

      expect(mockClient.evalSha).toHaveBeenCalledWith(
        MOCK_SHA,
        {
          keys: ['session:USR-12345', 'session:USR-12345:events'],
          arguments: [
            JSON.stringify(mockEvent),
            String(defaultTtl),
            expect.any(String), // score (timestamp ms)
            expect.any(String), // updatedAt ISO string
            'USR-12345',        // userId (for HSETNX init)
            'zalo',             // channel (for HSETNX init)
            'mock-uuid-session-id', // sessionId (for HSETNX init)
          ],
        },
      );
    });

    it('should use custom TTL when provided', async () => {
      await store.appendEvent('USR-12345', mockEvent, 172800);

      const callArgs = mockClient.evalSha.mock.calls[0][1];
      expect(callArgs.arguments[1]).toBe('172800');
    });

    it('should throw if scriptSha is null (not initialized)', async () => {
      // Create a new store without calling onModuleInit
      const uninitializedStore = new RedisSessionStore(
        mockCacheService as any,
        defaultTtl,
      );

      await expect(
        uninitializedStore.appendEvent('USR-12345', mockEvent),
      ).rejects.toThrow('Session Lua script not loaded');
    });

    it('should fall back to EVAL with the inlined script on NOSCRIPT error', async () => {
      mockClient.evalSha.mockRejectedValueOnce(new Error('NOSCRIPT No matching script'));

      await store.appendEvent('USR-12345', mockEvent);

      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call'),
        {
          keys: ['session:USR-12345', 'session:USR-12345:events'],
          arguments: [
            JSON.stringify(mockEvent),
            String(defaultTtl),
            expect.any(String),
            expect.any(String),
            'USR-12345',
            'zalo',
            'mock-uuid-session-id',
          ],
        },
      );
      // SHA should be re-loaded after fallback
      expect(mockClient.scriptLoad).toHaveBeenCalledTimes(2); // once on init, once after fallback
    });

    it('should throw non-NOSCRIPT errors', async () => {
      mockClient.evalSha.mockRejectedValueOnce(new Error('CONNECTION LOST'));

      await expect(store.appendEvent('USR-12345', mockEvent)).rejects.toThrow('CONNECTION LOST');
    });
  });

  // ── getSession ───────────────────────────────────────────────────────────────

  describe('getSession', () => {
    it('should return session metadata for existing session', async () => {
      mockClient.hGetAll.mockResolvedValue({
        sessionId: '550e8400-e29b-41d4-a716-446655440001',
        userId: 'USR-12345',
        channel: 'zalo',
        createdAt: '2026-06-12T10:00:00Z',
        updatedAt: '2026-06-12T10:30:00Z',
        eventCount: '5',
      });

      const result = await store.getSession('USR-12345');

      expect(result).toEqual({
        sessionId: '550e8400-e29b-41d4-a716-446655440001',
        userId: 'USR-12345',
        channel: 'zalo',
        createdAt: '2026-06-12T10:00:00Z',
        updatedAt: '2026-06-12T10:30:00Z',
        eventCount: 5,
      });
    });

    it('should return null for non-existent session', async () => {
      mockClient.hGetAll.mockResolvedValue({});

      const result = await store.getSession('USR-NONEXISTENT');

      expect(result).toBeNull();
    });

    it('should handle default eventCount when not present', async () => {
      mockClient.hGetAll.mockResolvedValue({
        sessionId: '550e8400-e29b-41d4-a716-446655440001',
        userId: 'USR-12345',
        channel: 'web',
        createdAt: '2026-06-12T10:00:00Z',
        updatedAt: '2026-06-12T10:30:00Z',
        // eventCount missing
      });

      const result = await store.getSession('USR-12345');

      expect(result?.eventCount).toBe(0);
    });
  });

  // ── getEvents ────────────────────────────────────────────────────────────────

  describe('getEvents', () => {
    it('should return parsed events from sorted set', async () => {
      const event1 = { ...mockEvent, id: 'evt-1', timestamp: '2026-06-12T10:00:00Z' };
      const event2 = { ...mockEvent, id: 'evt-2', timestamp: '2026-06-12T10:30:00Z' };
      mockClient.zRangeByScore.mockResolvedValue([
        JSON.stringify(event1),
        JSON.stringify(event2),
      ]);

      const result = await store.getEvents('USR-12345');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('evt-1');
      expect(result[1].id).toBe('evt-2');
    });

    it('should pass time range to ZRANGEBYSCORE', async () => {
      mockClient.zRangeByScore.mockResolvedValue([]);

      await store.getEvents('USR-12345', 1000, 2000);

      expect(mockClient.zRangeByScore).toHaveBeenCalledWith(
        'session:USR-12345:events',
        1000,
        2000,
      );
    });

    it('should use default range (0 to Infinity) when no range specified', async () => {
      mockClient.zRangeByScore.mockResolvedValue([]);

      await store.getEvents('USR-12345');

      expect(mockClient.zRangeByScore).toHaveBeenCalledWith(
        'session:USR-12345:events',
        0,
        Infinity,
      );
    });

    it('should return empty array when no events', async () => {
      mockClient.zRangeByScore.mockResolvedValue([]);

      const result = await store.getEvents('USR-12345');

      expect(result).toEqual([]);
    });

    it('should skip corrupted events and log warning', async () => {
      const validEvent = { ...mockEvent, id: 'evt-valid' };
      mockClient.zRangeByScore.mockResolvedValue([
        JSON.stringify(validEvent),
        'not-valid-json{{{',
        'also-broken',
      ]);

      const warnSpy = jest.spyOn(store['logger'], 'warn');
      const result = await store.getEvents('USR-12345');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('evt-valid');
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });
  });

  // ── sessionExists ────────────────────────────────────────────────────────────

  describe('sessionExists', () => {
    it('should return true when session exists', async () => {
      mockClient.exists.mockResolvedValue(1);

      const result = await store.sessionExists('USR-12345');

      expect(result).toBe(true);
      expect(mockClient.exists).toHaveBeenCalledWith('session:USR-12345');
    });

    it('should return false when session does not exist', async () => {
      mockClient.exists.mockResolvedValue(0);

      const result = await store.sessionExists('USR-NONEXISTENT');

      expect(result).toBe(false);
    });
  });
});
