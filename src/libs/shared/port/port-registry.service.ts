/**
 * Port Registry Service
 *
 * Central registry for all downstream service ports.
 * Routes calls through the correct adapter (mock/live),
 * integrates caching, circuit breaker, and fallback.
 *
 * AC: #1 (Port Registry Init), #2 (MOCK_MODE Override), #4 (Zero-Core-Change)
 */

import { Injectable, Inject, Logger, Optional, OnModuleInit } from '@nestjs/common';
import { CACHE_SERVICE_TOKEN, REQUEST_CONTEXT_TOKEN } from '../../core';
import type { ICacheService } from '../caching/cache.interface';
import type { IRequestContextProvider } from '../../core';
import { StructuredLogger } from '../observability/structured-logger.service';
import { EndpointConfigService } from '../endpoint-config/endpoint-config.service';
import { CircuitBreakerState } from '../resilience/circuit-breaker.state';
import { CircuitState } from '../resilience/circuit-breaker.decorator';
import { FallbackProvider } from '../resilience/fallback.provider';
import { QueueService, type ReplayJobPayload } from '../queue';
import type { IPortAdapter, PortConfig, PortEntry, PortResult, PortResultMetadata } from './port.interface';
import type { CacheTier, QueuePolicy } from '../endpoint-config/endpoint-config.interface';
import { InboundIdempotencyService } from './inbound-idempotency.service';
import { PortNotRegisteredException, PortFallbackException, PortDownstreamException, PortQueuedException } from './port-exceptions';
import { generateShortHash } from '../utils/hash.util';

/**
 * Default cache TTLs by tier (in seconds).
 */
const DEFAULT_TTL_BY_TIER: Record<CacheTier, number> = {
  static: 43200,     // 12 hours
  dynamic: 900,      // 15 minutes
  transaction: 0,    // No cache
};

/**
 * Default queue fallback policy by cache tier (when not set in YAML).
 * Writes (transaction tier) → always enqueue; reads → enqueue only on cache miss.
 */
function defaultQueuePolicy(tier: CacheTier): QueuePolicy {
  return tier === 'transaction' ? 'always' : 'on-cache-miss';
}

/**
 * Cache key version prefix. Bumped when the hash algorithm changes
 * to avoid orphaning old keys during deployment (prevents cache stampede).
 */
const CACHE_KEY_VERSION = 'v2';

/**
 * Shared errorFilter for circuit breakers: only count infrastructure
 * errors (5xx, timeouts) as CB failures. 4xx client errors do NOT
 * trip the circuit because they indicate a caller problem, not a
 * downstream outage.
 */
function isInfrastructureError(error: Error): boolean {
  if (error instanceof PortDownstreamException) {
    return error.statusCode >= 500;
  }
  // Timeouts and unknown errors always count
  return true;
}

@Injectable()
export class PortRegistry implements OnModuleInit {
  private readonly ports = new Map<string, PortEntry>();
  private readonly circuitBreakers = new Map<string, CircuitBreakerState>();
  private readonly logger = new Logger(PortRegistry.name);

  constructor(
    private readonly configService: EndpointConfigService,
    @Inject(CACHE_SERVICE_TOKEN)
    private readonly cacheService: ICacheService,
    private readonly fallbackProvider: FallbackProvider,
    private readonly structuredLogger: StructuredLogger,
    @Inject(REQUEST_CONTEXT_TOKEN)
    private readonly requestContext: IRequestContextProvider,
    @Optional()
    private readonly idempotencyService?: InboundIdempotencyService,
    @Optional()
    private readonly queueService?: QueueService,
  ) {}

  /**
   * Register the replay executor with the QueueService so the BullMQ worker
   * can call back into PortRegistry to replay a queued call inside a
   * synthesized request context. Breaks the DI cycle (QueueService does not
   * inject PortRegistry).
   */
  onModuleInit(): void {
    if (this.queueService) {
      this.queueService.setReplayExecutor(async (payload: ReplayJobPayload) =>
        this.executeReplay(payload),
      );
    }
  }

  /**
   * Register a new port with mock + live adapters.
   * Creates per-port CircuitBreakerState and registers fallback.
   *
   * AC: #1, #4 — Zero code changes needed to add new ports.
   */
  register(
    name: string,
    mockAdapter: IPortAdapter,
    liveAdapter: IPortAdapter,
    config?: Partial<PortConfig>,
  ): void {
    // Resolve config from endpoint-config service if available
    let resolvedConfig: PortConfig;

    if (this.configService.hasEndpointConfig(name)) {
      const endpointConfig = this.configService.getEndpointConfig(name);
      resolvedConfig = {
        name,
        cacheTier: endpointConfig.cacheTier,
        cacheTtl: endpointConfig.cacheTtl ?? DEFAULT_TTL_BY_TIER[endpointConfig.cacheTier],
        timeout: endpointConfig.timeout,
        queuePolicy: endpointConfig.queuePolicy ?? defaultQueuePolicy(endpointConfig.cacheTier),
        circuitBreaker: {
          errorThreshold: endpointConfig.circuitBreaker?.errorThreshold ?? 50,
          resetTimeout: endpointConfig.circuitBreaker?.resetTimeout ?? 10000,
          minRequests: endpointConfig.circuitBreaker?.minRequests ?? 5,
          name,
          errorFilter: isInfrastructureError,
        },
        active: true,
        ...config,
      };
    } else {
      // Fallback config if no YAML entry
      resolvedConfig = {
        name,
        cacheTier: 'dynamic',
        cacheTtl: DEFAULT_TTL_BY_TIER.dynamic,
        timeout: 3000,
        queuePolicy: 'never',
        circuitBreaker: {
          errorThreshold: 50,
          resetTimeout: 10000,
          minRequests: 5,
          name,
          errorFilter: isInfrastructureError,
        },
        active: true,
        ...config,
      };
    }

    // Create per-port circuit breaker
    const cb = new CircuitBreakerState(resolvedConfig.circuitBreaker, this.logger);
    this.circuitBreakers.set(name, cb);

    // Register fallback for this port (cache-based fallback)
    // Fix #3: Throw a distinct error when no cached fallback is available
    this.fallbackProvider.register(name, async (_error, _context) => {
      const cached = this.fallbackProvider.getCached(name);
      if (cached !== null && cached !== undefined) {
        this.logger.warn(`Returning cached fallback for port: ${name}`);
        return cached;
      }
      throw new PortFallbackException(name);
    });

    // Store port entry
    const entry: PortEntry = {
      name,
      mockAdapter,
      liveAdapter,
      config: resolvedConfig,
    };
    this.ports.set(name, entry);

    this.logger.log(`Registered port: ${name} (tier: ${resolvedConfig.cacheTier}, timeout: ${resolvedConfig.timeout}ms)`);
  }

  /**
   * Execute a port call.
   *
   * Flow:
   * 1. Resolve adapter (MOCK_MODE env → YAML adapter field → live)
   * 2. Check inbound idempotency (if idempotencyKey provided)
   * 3. Check cache (skip if transaction tier)
   * 4. Check circuit breaker state
   * 5. Execute via adapter
   * 6. On success: cache result, record CB success, store idempotency result
   * 7. On failure: record CB failure, attempt fallback
   *
   * AC: #1 (CB per-port), #2 (cachedAt timestamp), #7 (inbound idempotency)
   */
  async execute<T = unknown>(
    portName: string,
    method: string,
    params: Record<string, unknown> = {},
    idempotencyKey?: string,
  ): Promise<PortResult<T>> {
    const startTime = Date.now();
    const entry = this.ports.get(portName);

    if (!entry) {
      throw new PortNotRegisteredException(portName);
    }

    const correlationId = this.getCorrelationId();

    // Three-step priority chain — MOCK_MODE → YAML adapter field → live
    let adapter: IPortAdapter;
    let adapterUsed: 'mock' | 'live';

    if (this.configService.isMockMode()) {
      // Step 1: MOCK_MODE=true forces all ports to mock
      adapter = entry.mockAdapter;
      adapterUsed = 'mock';
    } else if (this.configService.hasEndpointConfig(portName)) {
      // Step 2: Respect per-service adapter field from YAML
      const endpointConfig = this.configService.getEndpointConfig(portName);
      const useMock = endpointConfig.adapter === 'mock';
      adapter = useMock ? entry.mockAdapter : entry.liveAdapter;
      adapterUsed = useMock ? 'mock' : 'live';
    } else {
      // Step 3: Default to live
      adapter = entry.liveAdapter;
      adapterUsed = 'live';
    }

    // AC: #7 — Check inbound idempotency FIRST (before cache check)
    if (idempotencyKey && this.idempotencyService) {
      const idempotencyResult = await this.idempotencyService.check<T>(idempotencyKey);
      if (idempotencyResult.hit && idempotencyResult.data !== undefined) {
        this.structuredLogger.info(`Idempotency hit, returning cached result [${portName}]`, {
          operation: { name: `${portName}:${method}` },
          trace: { correlationId },
          data: { idempotencyKey },
        });
        return {
          data: idempotencyResult.data,
          adapterUsed,
          fromCache: true,
          duration: Date.now() - startTime,
          metadata: { fromIdempotency: true },
        };
      }
    }

    // Cache READS only. A mutation method (create/update/send/link/...) must
    // always hit the downstream — a cached write result is stale and a correctness
    // bug (e.g. create-customer returning the pre-create state, or find-by-phone
    // after a create returning a cached null). Default-secure: only explicitly
    // read-like method names are cacheable; everything else bypasses the cache.
    const shouldCache =
      !this.isMutationMethod(method) &&
      entry.config.cacheTier !== 'transaction' &&
      entry.config.cacheTtl > 0;
    let cacheKey: string | undefined;

    if (shouldCache) {
      cacheKey = this.buildCacheKey(portName, method, params);
      const cachedEntry = await this.cacheService.get<{ data: T; cachedAt: string }>(cacheKey);
      // Fix #2: Use strict null check to avoid falsy-zero bug
      if (cachedEntry !== null && cachedEntry !== undefined) {
        return {
          data: cachedEntry.data,
          adapterUsed,
          fromCache: true,
          duration: Date.now() - startTime,
          metadata: {
            cachedAt: cachedEntry.cachedAt,
          },
        };
      }
    }

    // Check circuit breaker
    const cb = this.circuitBreakers.get(portName);
    if (cb) {
      if (cb.getState() === CircuitState.OPEN) {
        if (cb.shouldAttemptReset()) {
          cb.halfOpen();
          // AC: #3 — HALF_OPEN probe: allow single probe request
          this.structuredLogger.debug(`Circuit breaker HALF_OPEN probe [${portName}]`, {
            operation: { name: `${portName}:${method}` },
            trace: { correlationId },
          });
        } else {
          // AC: #1, #2 — Circuit open → return fallback with cachedAt metadata
          const cachedAt = new Date().toISOString();
          this.structuredLogger.warn(`Circuit breaker OPEN, returning fallback [${portName}]`, {
            operation: { name: `${portName}:${method}` },
            trace: { correlationId },
            data: { cbState: CircuitState.OPEN, cachedAt },
          });
          return this.executeWithQueue<T>(portName, entry, adapterUsed, startTime, null, method, params, idempotencyKey);
        }
      }
    }

    // Execute via adapter — only the adapter call is in the CB try/catch.
    // Post-processing writes (cache, fallback cache, idempotency) are
    // fire-and-forget so they cannot trip the circuit breaker.
    let data: T;
    let duration: number;

    try {
      data = (await adapter.execute(method, params)) as T;
      duration = Date.now() - startTime;

      // Record circuit breaker success
      cb?.recordSuccess();
    } catch (error) {
      const originalError = error as Error;

      // Record circuit breaker failure
      cb?.recordFailure(originalError);

      // AC: #1 — Check if circuit should open
      if (cb?.shouldOpen()) {
        cb.open();
        this.structuredLogger.error(
          `Circuit breaker tripped OPEN [${portName}]`,
          originalError,
          {
            operation: { name: `${portName}:${method}`, duration: Date.now() - startTime },
            trace: { correlationId },
            data: { cbState: CircuitState.OPEN },
          },
        );
      }

      // Pass original error to fallback for error chain preservation
      return this.executeWithQueue<T>(portName, entry, adapterUsed, startTime, originalError, method, params, idempotencyKey);
    }

    // ── Post-processing: fire-and-forget writes (Fix #1) ──────────
    // These are intentionally outside the adapter try/catch so that
    // cache/Redis failures do NOT trip the circuit breaker.
    const cachedAt = new Date().toISOString();

    // Write-through invalidation: a mutation busts the port's read cache so the
    // next read fetches fresh data (e.g. find-by-phone right after create-customer
    // must not return a stale cached null). Fire-and-forget — never trips the CB.
    // Defensive (Promise.resolve + try/catch): some cache impls / test mocks may
    // not return a thenable from deleteByPattern.
    if (this.isMutationMethod(method)) {
      try {
        Promise.resolve(
          this.cacheService.deleteByPattern(
            `cache:${CACHE_KEY_VERSION}:port:${portName}:*`,
          ),
        ).catch((e) =>
          this.logger.warn(
            `Cache invalidation failed for ${portName}: ${(e as Error).message}`,
          ),
        );
      } catch (e) {
        this.logger.warn(
          `Cache invalidation failed for ${portName}: ${(e as Error).message}`,
        );
      }
    }

    // Cache result with insertion timestamp (Fix #4)
    if (shouldCache && cacheKey) {
      try {
        await this.cacheService.set(cacheKey, { data, cachedAt }, entry.config.cacheTtl);
      } catch (cacheError) {
        this.logger.warn(`Cache write failed for ${portName}: ${(cacheError as Error).message}`);
      }
    }

    // Cache for fallback use
    this.fallbackProvider.setCached(portName, data);

    // AC: #7 — Store idempotency result after successful execution
    if (idempotencyKey && this.idempotencyService) {
      try {
        await this.idempotencyService.store(idempotencyKey, data);
      } catch (idempotencyError) {
        this.logger.warn(`Idempotency store failed for ${portName}: ${(idempotencyError as Error).message}`);
      }
    }

    return {
      data,
      adapterUsed,
      fromCache: false,
      duration,
    };
  }

  /**
   * Get a registered port entry.
   */
  getPort(name: string): PortEntry | undefined {
    return this.ports.get(name);
  }

  /**
   * Check if a port is registered.
   */
  hasPort(name: string): boolean {
    return this.ports.has(name);
  }

  /**
   * Get all registered port names.
   */
  getPortNames(): string[] {
    return Array.from(this.ports.keys());
  }

  /**
   * Get circuit breaker state for a port.
   */
  getCircuitBreakerState(portName: string): CircuitState | undefined {
    return this.circuitBreakers.get(portName)?.getState();
  }

  /**
   * Get all circuit breaker states for health reporting.
   * Returns port name → { state, metrics } mapping.
   */
  getAllCircuitBreakerStates(): Array<{
    portName: string;
    state: CircuitState;
    metrics: { requests: number; failures: number; successRate: number; failureRate: number };
  }> {
    return Array.from(this.circuitBreakers.entries()).map(([portName, cb]) => ({
      portName,
      state: cb.getState(),
      metrics: cb.getMetrics(),
    }));
  }

  /**
   * Execute fallback when circuit breaker is open or call fails.
   * Fix #3: Produces distinct error messages for original failure vs fallback failure.
   * AC: #2 — Adds metadata.degraded and metadata.cachedAt to fallback responses.
   */
  private async executeFallback<T>(
    portName: string,
    _entry: PortEntry,
    adapterUsed: 'mock' | 'live',
    startTime: number,
    originalError: Error | null,
  ): Promise<PortResult<T>> {
    const cachedAt = new Date().toISOString();

    try {
      const fallbackData = await this.fallbackProvider.execute(
        portName,
        originalError ?? new Error(`Circuit breaker open for ${portName}`),
        {
          operation: portName,
          args: [],
          attempt: 1,
          duration: Date.now() - startTime,
          failureType: 'circuit_breaker',
        },
      );

      const metadata: PortResultMetadata = {
        cachedAt,
        degraded: true,
        message: 'Service temporarily unavailable, serving cached data',
      };

      return {
        data: fallbackData as T,
        adapterUsed,
        fromCache: true,
        duration: Date.now() - startTime,
        metadata,
      };
    } catch (fallbackError) {
      // Preserve original error type via PortFallbackException with cause chain
      throw new PortFallbackException(portName, originalError ?? (fallbackError as Error));
    }
  }

  /**
   * Queued-tier fallback: decide between cache fallback and BullMQ enqueue
   * based on the port's queuePolicy. Called from the CB-OPEN and adapter-failure
   * paths instead of executeFallback directly.
   *
   * - `never` (or queue disabled): existing cache fallback → PortFallbackException on miss.
   * - `on-cache-miss`: serve stale cache (+ background refresh) if available; else enqueue + PortQueuedException.
   * - `always`: enqueue every failure + PortQueuedException (→ HTTP 202 via global filter).
   */
  private async executeWithQueue<T>(
    portName: string,
    entry: PortEntry,
    adapterUsed: 'mock' | 'live',
    startTime: number,
    originalError: Error | null,
    method: string,
    params: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<PortResult<T>> {
    const policy = entry.config.queuePolicy;

    // `never` (or queue tier disabled) → straight to cache fallback (existing behaviour)
    if (policy === 'never' || !this.queueService) {
      return this.executeFallback<T>(portName, entry, adapterUsed, startTime, originalError);
    }

    // `on-cache-miss` → serve stale cache if we have one, fire-and-forget a refresh
    if (policy === 'on-cache-miss') {
      const cached = this.fallbackProvider.getCached(portName);
      if (cached !== null && cached !== undefined) {
        this.enqueue(portName, method, params, idempotencyKey).catch((err) => {
          this.logger.warn(`Background refresh enqueue failed for ${portName}: ${(err as Error).message}`);
        });
        const metadata: PortResultMetadata = {
          cachedAt: new Date().toISOString(),
          degraded: true,
          message: 'Service temporarily unavailable, serving cached data (refresh queued)',
        };
        return {
          data: cached as T,
          adapterUsed,
          fromCache: true,
          duration: Date.now() - startTime,
          metadata,
        };
      }
      // No cache → fall through to enqueue + 202
    }

    // `always`, or `on-cache-miss` with no cache → enqueue + PortQueuedException (→ HTTP 202)
    const jobId = await this.enqueue(portName, method, params, idempotencyKey);
    throw new PortQueuedException(portName, jobId);
  }

  /**
   * Capture the current request context + enqueue a replay job.
   * Returns the BullMQ job id. Throws if the queue tier is disabled.
   */
  private async enqueue(
    portName: string,
    method: string,
    params: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<string> {
    const ctx = this.requestContext?.current();
    const payload: ReplayJobPayload = {
      portName,
      method,
      params,
      idempotencyKey,
      context: {
        correlationId: ctx?.correlationId ?? 'no-correlation-id',
        userId: ctx?.userId,
        tenantId: ctx?.tenantId,
        metadata: ctx?.metadata,
      },
    };
    return this.queueService!.enqueue(payload);
  }

  /**
   * Replay a queued call from the BullMQ worker, inside a synthesized request
   * context so PortHttpClient can re-sign the downstream JWT.
   *
   * Runs the live adapter directly (no queue re-entry, no CB-open gate). On
   * success: refresh the fallback cache. On failure: throw → BullMQ retries
   * with backoff → DLQ after max attempts.
   */
  async executeReplay(payload: ReplayJobPayload): Promise<unknown> {
    const entry = this.ports.get(payload.portName);
    if (!entry) {
      throw new PortNotRegisteredException(payload.portName);
    }

    const syntheticContext = this.requestContext.createFull({
      correlationId: payload.context.correlationId,
      userId: payload.context.userId,
      tenantId: payload.context.tenantId,
      metadata: payload.context.metadata,
    });

    // Run the live adapter call inside the synthesized context so PortHttpClient
    // signs a fresh downstream JWT from context.userId + metadata.
    const data = await this.requestContext.run(syntheticContext, () =>
      entry.liveAdapter.execute(payload.method, payload.params),
    );

    // Refresh the fallback cache so future requests can serve it directly
    this.fallbackProvider.setCached(payload.portName, data);
    return data;
  }

  /**
   * Convention: mutation methods bypass the cache (a cached write result is stale
   * → correctness bug, e.g. create-customer returning pre-create state, or
   * find-by-phone after a create returning a cached null). Everything else
   * (get/find/search/list/call/...) is cacheable per the port's tier. Add a verb
   * here when a new write method name is introduced.
   */
  private isMutationMethod(method: string): boolean {
    return /^(create|update|delete|remove|add|insert|save|send|submit|dispatch|pay|setup|initiate|retry|cancel|confirm|generate|register|verify|login|logout|refresh|link|unlink|close|archive|assign|sign|post|put)/.test(
      method,
    );
  }

  /**
   * Build cache key for a port call.
   * Uses SHA-256 (16-char truncated) via shared hash utility.
   * Pattern: cache:v2:port:{portName}:{sha256OfMethodAndParams}
   *
   * Fix #8: v2 prefix prevents cache stampede when hash algorithm changes.
   */
  private buildCacheKey(
    portName: string,
    method: string,
    params: Record<string, unknown>,
  ): string {
    const payload = JSON.stringify({ method, params });
    const hash = generateShortHash(payload);
    return `cache:${CACHE_KEY_VERSION}:port:${portName}:${hash}`;
  }

  /**
   * Get the current correlation ID from request context.
   * Falls back to 'no-correlation-id' if context is not available.
   */
  private getCorrelationId(): string {
    const context = this.requestContext?.current();
    return context?.correlationId ?? 'no-correlation-id';
  }
}
