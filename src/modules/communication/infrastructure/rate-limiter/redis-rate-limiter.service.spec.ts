import { RedisRateLimiterService } from './redis-rate-limiter.service';

describe('RedisRateLimiterService', () => {
  let service: RedisRateLimiterService;
  let cacheService: { incr: jest.Mock; set: jest.Mock };

  beforeEach(() => {
    cacheService = { incr: jest.fn(), set: jest.fn() };
    service = new RedisRateLimiterService(cacheService as any);
  });

  // ── App-only: ZNS/SMS/email disabled (limit 0) ──────────────────────────

  describe('check — ZNS channel (disabled, limit 0)', () => {
    it('should always block ZNS (disabled — App-only)', async () => {
      const result = await service.check('USR-001', 'zns');
      expect(result.allowed).toBe(false);
      expect(result.limit).toBe(0);
    });
  });

  describe('check — sms channel (disabled, limit 0)', () => {
    it('should always block SMS (disabled — App-only)', async () => {
      const result = await service.check('USR-001', 'sms');
      expect(result.allowed).toBe(false);
      expect(result.limit).toBe(0);
    });
  });

  // ── Push channel (limit 50) ──────────────────────────────────────────────

  describe('check — push channel (limit 50)', () => {
    it('should allow under limit', async () => {
      cacheService.incr.mockResolvedValue(25);

      const result = await service.check('USR-001', 'push');

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(50);
    });

    it('should block over limit', async () => {
      cacheService.incr.mockResolvedValue(51);

      const result = await service.check('USR-001', 'push');

      expect(result.allowed).toBe(false);
    });
  });

  // ── In-App channel (no limit) ────────────────────────────────────────────

  describe('check — in_app channel (no limit)', () => {
    it('should always allow', async () => {
      const result = await service.check('USR-001', 'in_app');

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(Infinity);
      expect(cacheService.incr).not.toHaveBeenCalled();
    });
  });

  // ── TTL management ────────────────────────────────────────────────────────

  describe('TTL management', () => {
    it('should set TTL on first increment', async () => {
      cacheService.incr.mockResolvedValue(1);

      await service.check('USR-001', 'push');

      expect(cacheService.set).toHaveBeenCalledTimes(1);
      expect(cacheService.set.mock.calls[0][2]).toBe(86400);
    });

    it('should NOT set TTL on subsequent increments', async () => {
      cacheService.incr.mockResolvedValue(2);

      await service.check('USR-001', 'push');

      expect(cacheService.set).not.toHaveBeenCalled();
    });

    it('should use per-channel key for INCR', async () => {
      cacheService.incr.mockResolvedValue(1);

      await service.check('USR-001', 'push');

      const incrKey = cacheService.incr.mock.calls[0][0];
      expect(incrKey).toContain(':push:');
    });
  });

  // ── Fallback chain ────────────────────────────────────────────────────────

  describe('getFallbackChain', () => {
    it('should return Push → In-App (App-only)', () => {
      const chain = service.getFallbackChain();

      expect(chain).toEqual(['push', 'in_app']);
    });

    it('should return a copy (not mutable)', () => {
      const chain = service.getFallbackChain();
      chain.push('sms');

      const chain2 = service.getFallbackChain();
      expect(chain2).toEqual(['push', 'in_app']);
    });
  });
});
