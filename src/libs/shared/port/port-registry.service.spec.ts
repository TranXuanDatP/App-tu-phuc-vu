/**
 * PortRegistry Tests
 *
 * AC: #1 (CB Per-Port), #2 (Cached Response with Timestamp), #3 (HALF_OPEN Probe),
 *     #4 (Static Cache), #5 (Dynamic Cache), #6 (Transaction No Cache),
 *     #7 (Inbound Idempotency)
 */

import { Logger } from '@nestjs/common';
import { EndpointConfigService } from '../endpoint-config/endpoint-config.service';
import { StructuredLogger } from '../observability/structured-logger.service';
import { FallbackProvider } from '../resilience/fallback.provider';
import { CircuitState } from '../resilience/circuit-breaker.decorator';
import { PortRegistry } from './port-registry.service';
import { InboundIdempotencyService } from './inbound-idempotency.service';
import type { IPortAdapter } from './port.interface';

// Mock ICacheService
const mockCacheService = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  delete: jest.fn().mockResolvedValue(undefined),
  deleteByPattern: jest.fn().mockResolvedValue(0),
  exists: jest.fn().mockResolvedValue(false),
  clear: jest.fn().mockResolvedValue(undefined),
  mget: jest.fn().mockResolvedValue([]),
  mset: jest.fn().mockResolvedValue(undefined),
  mdelete: jest.fn().mockResolvedValue(undefined),
  incr: jest.fn().mockResolvedValue(1),
  decr: jest.fn().mockResolvedValue(0),
  ttl: jest.fn().mockResolvedValue(-1),
};

// Mock RequestContextProvider
const mockRequestContext = {
  current: jest.fn().mockReturnValue({ correlationId: 'test-correlation-123' }),
  run: jest.fn(),
  create: jest.fn(),
  createFull: jest.fn(),
};

// Mock InboundIdempotencyService
const mockIdempotencyService = {
  check: jest.fn().mockResolvedValue({ hit: false }),
  store: jest.fn().mockResolvedValue(undefined),
};

// Mock adapters
const createMockAdapter = (returnValue: unknown): IPortAdapter => ({
  execute: jest.fn().mockResolvedValue(returnValue),
});

const createFailingAdapter = (error: Error): IPortAdapter => ({
  execute: jest.fn().mockRejectedValue(error),
});

describe('PortRegistry', () => {
  let registry: PortRegistry;
  let configService: EndpointConfigService;
  let fallbackProvider: FallbackProvider;
  let structuredLogger: StructuredLogger;
  let fallbackCache: Map<string, unknown>;

  beforeEach(() => {
    structuredLogger = new StructuredLogger();
    configService = new EndpointConfigService(structuredLogger);
    fallbackCache = new Map();
    // Pass fallbackCache so setCached/getCached work in tests
    fallbackProvider = new FallbackProvider(structuredLogger, fallbackCache);

    registry = new PortRegistry(
      configService,
      mockCacheService as any,
      fallbackProvider,
      structuredLogger,
      mockRequestContext as any,
      mockIdempotencyService as any,
    );

    jest.clearAllMocks();
  });

  // =========================================================================
  // register
  // =========================================================================
  describe('register', () => {
    it('should register a port with mock and live adapters', () => {
      const mockAdapter = createMockAdapter({ data: 'mock' });
      const liveAdapter = createMockAdapter({ data: 'live' });

      registry.register('test-port', mockAdapter, liveAdapter, {
        cacheTier: 'dynamic',
        cacheTtl: 900,
        timeout: 3000,
      } as any);

      expect(registry.hasPort('test-port')).toBe(true);
      expect(registry.getPortNames()).toContain('test-port');
    });

    it('should register multiple ports', () => {
      registry.register('port-a', createMockAdapter({}), createMockAdapter({}));
      registry.register('port-b', createMockAdapter({}), createMockAdapter({}));

      expect(registry.getPortNames()).toHaveLength(2);
      expect(registry.getPortNames()).toContain('port-a');
      expect(registry.getPortNames()).toContain('port-b');
    });
  });

  // =========================================================================
  // execute — mock adapter
  // =========================================================================
  describe('execute — mock adapter', () => {
    it('should use mock adapter when MOCK_MODE=true', async () => {
      const original = process.env.MOCK_MODE;
      process.env.MOCK_MODE = 'true';

      const mockAdapter = createMockAdapter({ data: 'mock-response' });
      const liveAdapter = createMockAdapter({ data: 'live-response' });

      registry.register('test-port', mockAdapter, liveAdapter, {
        cacheTier: 'dynamic',
        cacheTtl: 900,
        timeout: 3000,
      } as any);

      const result = await registry.execute('test-port', 'get-item');

      expect(result.data).toEqual({ data: 'mock-response' });
      expect(result.adapterUsed).toBe('mock');
      expect(mockAdapter.execute).toHaveBeenCalledWith('get-item', {});

      process.env.MOCK_MODE = original;
    });
  });

  // =========================================================================
  // execute — live adapter
  // =========================================================================
  describe('execute — live adapter', () => {
    it('should use live adapter when config says live and MOCK_MODE=false', async () => {
      const original = process.env.MOCK_MODE;
      delete process.env.MOCK_MODE;

      const mockAdapter = createMockAdapter({ data: 'mock-response' });
      const liveAdapter = createMockAdapter({ data: 'live-response' });

      registry.register('test-port', mockAdapter, liveAdapter, {
        cacheTier: 'dynamic',
        cacheTtl: 900,
        timeout: 3000,
      } as any);

      const result = await registry.execute('test-port', 'get-item');

      expect(result.data).toEqual({ data: 'live-response' });
      expect(result.adapterUsed).toBe('live');
      expect(liveAdapter.execute).toHaveBeenCalledWith('get-item', {});

      process.env.MOCK_MODE = original;
    });
  });

  // =========================================================================
  // execute — YAML adapter priority (Step 2)
  // =========================================================================
  describe('execute — YAML adapter priority (Step 2)', () => {
    it('should use mock adapter when YAML config says adapter:mock and MOCK_MODE is off', async () => {
      const original = process.env.MOCK_MODE;
      const originalBackendUrl = process.env.BACKEND_BASE_URL;
      delete process.env.MOCK_MODE;
      process.env.BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || 'http://localhost:8080';

      // Load real YAML config
      await configService.onModuleInit();

      const mockAdapter = createMockAdapter({ data: 'yaml-mock' });
      const liveAdapter = createMockAdapter({ data: 'yaml-live' });

      // 'invoice' exists in api-endpoints.yaml with adapter: mock
      registry.register('invoice', mockAdapter, liveAdapter);

      const result = await registry.execute('invoice', 'get-list');

      expect(result.data).toEqual({ data: 'yaml-mock' });
      expect(result.adapterUsed).toBe('mock');
      expect(mockAdapter.execute).toHaveBeenCalledWith('get-list', {});

      await configService.onModuleDestroy();
      process.env.MOCK_MODE = original;
      if (originalBackendUrl === undefined) {
        delete process.env.BACKEND_BASE_URL;
      } else {
        process.env.BACKEND_BASE_URL = originalBackendUrl;
      }
    });
  });

  // =========================================================================
  // execute — cache hit (AC: #2 cachedAt metadata)
  // =========================================================================
  describe('execute — cache hit', () => {
    it('should return cached data without calling adapter for static tier', async () => {
      const cachedData = { data: 'cached' };
      // Cache stores { data, cachedAt } wrapper (Fix #4)
      mockCacheService.get.mockResolvedValueOnce({ data: cachedData, cachedAt: '2026-06-05T10:00:00.000Z' });

      const adapter = createMockAdapter({ data: 'fresh' });

      registry.register('static-port', adapter, adapter, {
        cacheTier: 'static',
        cacheTtl: 43200,
        timeout: 3000,
      } as any);

      const result = await registry.execute('static-port', 'get-item');

      expect(result.data).toEqual(cachedData);
      expect(result.fromCache).toBe(true);
      expect(adapter.execute).not.toHaveBeenCalled();
    });

    it('should include cachedAt metadata on cache hit (AC: #2)', async () => {
      const cachedData = { data: 'cached-with-timestamp' };
      const storedCachedAt = '2026-06-05T10:00:00.000Z';
      mockCacheService.get.mockResolvedValueOnce({ data: cachedData, cachedAt: storedCachedAt });

      const adapter = createMockAdapter({ data: 'fresh' });

      registry.register('static-port', adapter, adapter, {
        cacheTier: 'static',
        cacheTtl: 43200,
        timeout: 3000,
      } as any);

      const result = await registry.execute('static-port', 'get-item');

      expect(result.metadata?.cachedAt).toBe(storedCachedAt);
      expect(typeof result.metadata?.cachedAt).toBe('string');
    });
  });

  // =========================================================================
  // execute — transaction tier (no cache) — AC: #6
  // =========================================================================
  describe('execute — transaction tier (no cache)', () => {
    it('should always call adapter and not use cache for transaction tier', async () => {
      const adapter = createMockAdapter({ data: 'fresh' });

      registry.register('payment-port', adapter, adapter, {
        cacheTier: 'transaction',
        cacheTtl: 0,
        timeout: 5000,
      } as any);

      const result = await registry.execute('payment-port', 'initiate');

      expect(result.data).toEqual({ data: 'fresh' });
      expect(result.fromCache).toBe(false);
      expect(adapter.execute).toHaveBeenCalledWith('initiate', {});
    });

    it('should not write to cache on transaction tier (AC: #6)', async () => {
      const adapter = createMockAdapter({ data: 'fresh' });

      registry.register('payment-port', adapter, adapter, {
        cacheTier: 'transaction',
        cacheTtl: 0,
        timeout: 5000,
      } as any);

      await registry.execute('payment-port', 'initiate');

      expect(mockCacheService.set).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // execute — mutation cache bypass + invalidation (write-through correctness)
  // =========================================================================
  describe('execute — mutation cache bypass + invalidation', () => {
    const registerStaticPort = () => {
      const adapter = createMockAdapter({ ok: true });
      registry.register('customer-profile', adapter, adapter, {
        cacheTier: 'static',
        cacheTtl: 43200,
        timeout: 3000,
      } as any);
      return adapter;
    };

    it('should NOT cache a mutation method (create/update/send/... bypass cache)', async () => {
      registerStaticPort();
      await registry.execute('customer-profile', 'create-customer', {
        fullName: 'A',
      });
      expect(mockCacheService.set).not.toHaveBeenCalled();
    });

    it('should invalidate the port read cache after a mutation (read-after-write freshness)', async () => {
      registerStaticPort();
      await registry.execute('customer-profile', 'create-customer', {
        fullName: 'A',
      });
      expect(mockCacheService.deleteByPattern).toHaveBeenCalledWith(
        'cache:v2:port:customer-profile:*',
      );
    });

    it('should still cache a read method and not invalidate', async () => {
      registerStaticPort();
      await registry.execute('customer-profile', 'get-profile', {
        customerId: 'X',
      });
      expect(mockCacheService.set).toHaveBeenCalled();
      expect(mockCacheService.deleteByPattern).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // execute — unregistered port
  // =========================================================================
  describe('execute — unregistered port', () => {
    it('should throw when calling an unregistered port', async () => {
      await expect(
        registry.execute('nonexistent', 'get'),
      ).rejects.toThrow('Port not registered: nonexistent');
    });
  });

  // =========================================================================
  // execute — circuit breaker — AC: #1, #2, #3
  // =========================================================================
  describe('execute — circuit breaker', () => {
    it('should open circuit breaker after repeated failures (AC: #1)', async () => {
      const adapter = createFailingAdapter(new Error('Service down'));

      registry.register('flaky-port', adapter, adapter, {
        cacheTier: 'dynamic',
        cacheTtl: 900,
        timeout: 3000,
      } as any);

      // Make multiple failing calls to trigger circuit breaker
      // (need minRequests + high failure rate)
      for (let i = 0; i < 10; i++) {
        try {
          await registry.execute('flaky-port', 'call');
        } catch {
          // Expected to fail
        }
      }

      // Circuit breaker should be OPEN
      const cbState = registry.getCircuitBreakerState('flaky-port');
      expect(cbState).toBe(CircuitState.OPEN);
    });

    it('should return cached fallback data when CB is OPEN with cachedAt metadata (AC: #2)', async () => {
      const successAdapter = createMockAdapter({ data: 'original' });
      const failAdapter = createFailingAdapter(new Error('Down'));

      registry.register('invoice-port', successAdapter, successAdapter, {
        cacheTier: 'dynamic',
        cacheTtl: 900,
        timeout: 3000,
      } as any);

      // First call succeeds and caches in fallback
      await registry.execute('invoice-port', 'get-list');

      // Force CB to OPEN by replacing adapter with failing one and making calls
      const entry = registry.getPort('invoice-port')!;
      // Override adapter to fail
      (entry as any).liveAdapter = failAdapter;
      (entry as any).mockAdapter = failAdapter;

      for (let i = 0; i < 10; i++) {
        try {
          await registry.execute('invoice-port', 'get-list');
        } catch {
          // Expected
        }
      }

      // Now CB should be OPEN — next call returns fallback
      mockCacheService.get.mockResolvedValue(null); // No cache hit
      const result = await registry.execute('invoice-port', 'get-list');

      expect(result.fromCache).toBe(true);
      expect(result.metadata?.degraded).toBe(true);
      expect(result.metadata?.cachedAt).toBeDefined();
      expect(result.metadata?.message).toBeDefined();
    });

    it('should isolate CB states between ports — invoice OPEN does not affect payment (AC: #1)', async () => {
      const failAdapter = createFailingAdapter(new Error('Down'));
      const successAdapter = createMockAdapter({ data: 'ok' });

      // Register two ports
      registry.register('invoice-port', failAdapter, failAdapter, {
        cacheTier: 'dynamic',
        cacheTtl: 900,
        timeout: 3000,
      } as any);
      registry.register('payment-port', successAdapter, successAdapter, {
        cacheTier: 'transaction',
        cacheTtl: 0,
        timeout: 3000,
      } as any);

      // Trip invoice CB
      for (let i = 0; i < 10; i++) {
        try {
          await registry.execute('invoice-port', 'call');
        } catch {
          // Expected
        }
      }

      // Invoice CB should be OPEN
      expect(registry.getCircuitBreakerState('invoice-port')).toBe(CircuitState.OPEN);

      // Payment should still work fine
      const result = await registry.execute('payment-port', 'call');
      expect(result.data).toEqual({ data: 'ok' });
      expect(result.fromCache).toBe(false);
    });
  });

  // =========================================================================
  // execute — cache tier TTL verification — AC: #4, #5
  // =========================================================================
  describe('execute — cache tier TTL', () => {
    it('should cache static tier with TTL ~43200s (AC: #4)', async () => {
      const adapter = createMockAdapter({ data: 'static-data' });

      registry.register('static-port', adapter, adapter, {
        cacheTier: 'static',
        cacheTtl: 43200,
        timeout: 3000,
      } as any);

      await registry.execute('static-port', 'get-item');

      // Cache stores { data, cachedAt } wrapper (Fix #4)
      expect(mockCacheService.set).toHaveBeenCalledWith(
        expect.stringContaining('v2'),
        expect.objectContaining({ data: { data: 'static-data' } }),
        43200,
      );
    });

    it('should cache dynamic tier with TTL ~900s (AC: #5)', async () => {
      const adapter = createMockAdapter({ data: 'dynamic-data' });

      registry.register('dynamic-port', adapter, adapter, {
        cacheTier: 'dynamic',
        cacheTtl: 900,
        timeout: 3000,
      } as any);

      await registry.execute('dynamic-port', 'get-item');

      expect(mockCacheService.set).toHaveBeenCalledWith(
        expect.stringContaining('v2'),
        expect.objectContaining({ data: { data: 'dynamic-data' } }),
        900,
      );
    });
  });

  // =========================================================================
  // execute — inbound idempotency — AC: #7
  // =========================================================================
  describe('execute — inbound idempotency', () => {
    it('should return cached result on idempotency hit without calling adapter (AC: #7)', async () => {
      const adapter = createMockAdapter({ data: 'should-not-be-called' });
      const cachedResult = { data: 'idempotency-cached' };

      mockIdempotencyService.check.mockResolvedValueOnce({
        hit: true,
        data: cachedResult,
      });

      registry.register('webhook-port', adapter, adapter, {
        cacheTier: 'transaction',
        cacheTtl: 0,
        timeout: 3000,
      } as any);

      const result = await registry.execute(
        'webhook-port',
        'confirm',
        { messageId: 'msg-123' },
        'msg-123',
      );

      expect(result.data).toEqual(cachedResult);
      expect(result.fromCache).toBe(true);
      expect(result.metadata?.fromIdempotency).toBe(true);
      expect(adapter.execute).not.toHaveBeenCalled();
    });

    it('should process and store result on idempotency miss (AC: #7)', async () => {
      const adapter = createMockAdapter({ data: 'fresh-result' });

      mockIdempotencyService.check.mockResolvedValueOnce({ hit: false });

      registry.register('webhook-port', adapter, adapter, {
        cacheTier: 'transaction',
        cacheTtl: 0,
        timeout: 3000,
      } as any);

      const result = await registry.execute(
        'webhook-port',
        'confirm',
        { messageId: 'msg-456' },
        'msg-456',
      );

      expect(result.data).toEqual({ data: 'fresh-result' });
      expect(result.fromCache).toBe(false);
      expect(mockIdempotencyService.store).toHaveBeenCalledWith(
        'msg-456',
        { data: 'fresh-result' },
      );
    });

    it('should check idempotency before cache', async () => {
      const adapter = createMockAdapter({ data: 'fresh' });
      const cachedResult = { data: 'idem-hit' };

      mockIdempotencyService.check.mockResolvedValueOnce({
        hit: true,
        data: cachedResult,
      });
      // Even if cache has data, idempotency should win
      mockCacheService.get.mockResolvedValueOnce({ data: 'cache-hit' });

      registry.register('test-port', adapter, adapter, {
        cacheTier: 'dynamic',
        cacheTtl: 900,
        timeout: 3000,
      } as any);

      const result = await registry.execute('test-port', 'call', {}, 'idem-key');

      expect(result.data).toEqual(cachedResult);
      expect(result.metadata?.fromIdempotency).toBe(true);
      // Cache should NOT have been checked
      expect(mockCacheService.get).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // execute — Queued tier (Live→Cached→Queued) — queuePolicy
  // =========================================================================
  describe('execute — Queued tier', () => {
    let queuedRegistry: PortRegistry;
    let mockQueueService: { enqueue: jest.Mock; setReplayExecutor: jest.Mock };

    beforeEach(() => {
      mockQueueService = {
        enqueue: jest.fn().mockResolvedValue('job-abc-123'),
        setReplayExecutor: jest.fn(),
      };
      // Deterministic cache mock — clearAllMocks() does NOT reset mockResolvedValueOnce
      // queues, so leftover once-values from earlier describes could turn a seed call into
      // a false cache hit. Reset to a clean null default for every queued-tier test.
      mockCacheService.get.mockReset();
      mockCacheService.get.mockResolvedValue(null);
      queuedRegistry = new PortRegistry(
        configService,
        mockCacheService as any,
        fallbackProvider,
        structuredLogger,
        mockRequestContext as any,
        mockIdempotencyService as any,
        mockQueueService as any,
      );
      // queuedRegistry.onModuleInit() registers the replay executor — not needed here
    });

    it('queuePolicy=always: enqueues + throws PortQueuedException on adapter failure', async () => {
      const failAdapter = createFailingAdapter(new Error('downstream down'));
      queuedRegistry.register('write-port', failAdapter, failAdapter, {
        cacheTier: 'transaction',
        cacheTtl: 0,
        timeout: 3000,
        queuePolicy: 'always',
      } as any);

      await expect(queuedRegistry.execute('write-port', 'create', { x: 1 })).rejects.toThrow(
        'Request queued for retry [write-port]: jobId=job-abc-123',
      );
      expect(mockQueueService.enqueue).toHaveBeenCalledTimes(1);
      const payload = mockQueueService.enqueue.mock.calls[0][0];
      expect(payload.portName).toBe('write-port');
      expect(payload.method).toBe('create');
      expect(payload.params).toEqual({ x: 1 });
    });

    it('queuePolicy=on-cache-miss: serves stale cache + fire-and-forget refresh', async () => {
      // Seed fallback cache with a prior successful result
      const seedAdapter = createMockAdapter({ data: 'stale' });
      queuedRegistry.register('read-port', seedAdapter, seedAdapter, {
        cacheTier: 'dynamic',
        cacheTtl: 900,
        timeout: 3000,
        queuePolicy: 'on-cache-miss',
      } as any);
      await queuedRegistry.execute('read-port', 'get'); // populates fallback cache

      // Flip adapter to fail (simulating outage)
      const entry = queuedRegistry.getPort('read-port')!;
      const failAdapter = createFailingAdapter(new Error('down'));
      (entry as any).liveAdapter = failAdapter;
      (entry as any).mockAdapter = failAdapter;
      mockCacheService.get.mockResolvedValue(null); // request cache miss

      const result = await queuedRegistry.execute('read-port', 'get');

      expect(result.fromCache).toBe(true);
      expect(result.metadata?.degraded).toBe(true);
      expect(result.metadata?.message).toContain('refresh queued');
      expect(mockQueueService.enqueue).toHaveBeenCalled(); // background refresh enqueued
    });

    it('queuePolicy=on-cache-miss with NO cache: enqueues + PortQueuedException', async () => {
      const failAdapter = createFailingAdapter(new Error('down'));
      queuedRegistry.register('fresh-port', failAdapter, failAdapter, {
        cacheTier: 'dynamic',
        cacheTtl: 900,
        timeout: 3000,
        queuePolicy: 'on-cache-miss',
      } as any);

      await expect(queuedRegistry.execute('fresh-port', 'get')).rejects.toThrow(
        'Request queued for retry [fresh-port]: jobId=job-abc-123',
      );
      expect(mockQueueService.enqueue).toHaveBeenCalledTimes(1);
    });

    it('queuePolicy=never: falls back to cache then PortFallbackException (no enqueue)', async () => {
      const failAdapter = createFailingAdapter(new Error('down'));
      queuedRegistry.register('safe-port', failAdapter, failAdapter, {
        cacheTier: 'dynamic',
        cacheTtl: 900,
        timeout: 3000,
        queuePolicy: 'never',
      } as any);

      await expect(queuedRegistry.execute('safe-port', 'get')).rejects.toThrow(/safe-port/);
      expect(mockQueueService.enqueue).not.toHaveBeenCalled();
    });

    it('executeReplay: calls live adapter inside synthesized context + refreshes fallback', async () => {
      const liveAdapter = createMockAdapter({ replayed: true });
      queuedRegistry.register('replay-port', createMockAdapter({}), liveAdapter, {
        cacheTier: 'dynamic',
        cacheTtl: 900,
        timeout: 3000,
        queuePolicy: 'always',
      } as any);
      mockRequestContext.createFull.mockReturnValue({ correlationId: 'replay-correlation' });
      mockRequestContext.run.mockImplementation((_ctx: unknown, cb: () => unknown) => cb());

      const data = await queuedRegistry.executeReplay({
        portName: 'replay-port',
        method: 'get',
        params: { id: 9 },
        context: { correlationId: 'replay-correlation' },
      });

      expect(data).toEqual({ replayed: true });
      expect(liveAdapter.execute).toHaveBeenCalledWith('get', { id: 9 });
      expect(mockRequestContext.run).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getPort
  // =========================================================================
  describe('getPort', () => {
    it('should return undefined for unregistered port', () => {
      expect(registry.getPort('nonexistent')).toBeUndefined();
    });

    it('should return port entry for registered port', () => {
      const mockAdapter = createMockAdapter({});
      const liveAdapter = createMockAdapter({});

      registry.register('my-port', mockAdapter, liveAdapter);

      const entry = registry.getPort('my-port');
      expect(entry).toBeDefined();
      expect(entry?.name).toBe('my-port');
      expect(entry?.mockAdapter).toBe(mockAdapter);
      expect(entry?.liveAdapter).toBe(liveAdapter);
    });
  });
});
