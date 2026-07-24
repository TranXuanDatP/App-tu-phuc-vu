/**
 * Queue Service — Queued resilience tier (Live→Cached→Queued)
 *
 * BullMQ-based retry queue powering NFR-R2 (0% total outage). When a port's
 * circuit breaker is OPEN and there is no cache to serve, or a write op fails,
 * PortRegistry enqueues a replay job here and the global filter returns HTTP 202.
 * A worker replays the call (inside a synthesized request context) with
 * exponential backoff; persistent failure is retained (removeOnFail) + logged
 * as the dead-letter signal for inspection via BullMQ adapters/CLI.
 *
 * BullMQ bundles its own `ioredis`, so we pass PLAIN connection options (bullmq
 * creates its clients internally) instead of an ioredis instance — this avoids a
 * duplicate-ioredis type conflict. The queue shares the cache's Redis server on
 * a separate logical DB (REDIS_QUEUE_DB, default 1) so `bull:*` keys never
 * collide with cache `ioc:*` keys.
 *
 * Disabled gracefully when REDIS_HOST is unset (dev/memory mode): enqueue()
 * throws so PortRegistry falls back to cache/error behaviour.
 */

import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { StructuredLogger } from '../observability/structured-logger.service';

/**
 * Payload persisted on the queue. Carries everything the worker needs to
 * replay the call offline: the port call identity + the originating request
 * context (used to re-sign the downstream JWT).
 */
export interface ReplayJobPayload {
  portName: string;
  method: string;
  params: Record<string, unknown>;
  idempotencyKey?: string;
  context: {
    correlationId: string;
    userId?: string;
    tenantId?: string;
    metadata?: Record<string, unknown>;
  };
}

/** Replay strategy registered by PortRegistry (avoids circular DI). */
export type ReplayExecutor = (payload: ReplayJobPayload) => Promise<unknown>;

// BullMQ forbids ':' in queue names (it's the Redis key separator), so use '-'.
const QUEUE_NAME = 'cskh-port-replay';

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private replayExecutor: ReplayExecutor | null = null;

  private readonly concurrency: number;
  private readonly maxAttempts: number;
  private readonly backoffDelay: number;
  /** True when Redis is configured (queue tier active). */
  readonly enabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly structuredLogger: StructuredLogger,
  ) {
    this.enabled = !!this.configService.get<string>('REDIS_HOST');
    this.concurrency = this.configService.get<number>('QUEUE_CONCURRENCY', 4);
    this.maxAttempts = this.configService.get<number>('QUEUE_MAX_ATTEMPTS', 5);
    this.backoffDelay = this.configService.get<number>('QUEUE_BACKOFF_MS', 2000);
  }

  /** PortRegistry registers its replay handler on init (breaks the DI cycle). */
  setReplayExecutor(fn: ReplayExecutor): void {
    this.replayExecutor = fn;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.warn('Queue tier DISABLED (no REDIS_HOST) — queuePolicy falls back to cache/error.');
      return;
    }

    // Plain ioredis options — bullmq creates its own client(s) from these.
    const connectionOpts = {
      host: this.configService.get<string>('REDIS_HOST'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD'),
      db: this.configService.get<number>('REDIS_QUEUE_DB', 1),
      // BullMQ requirements:
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    };

    this.queue = new Queue(QUEUE_NAME, { connection: connectionOpts });

    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        if (!this.replayExecutor) {
          throw new Error('Replay executor not registered');
        }
        return this.replayExecutor(job.data as ReplayJobPayload);
      },
      {
        // BullMQ creates a distinct connection for the worker from these options.
        connection: { ...connectionOpts },
        concurrency: this.concurrency,
      },
    );

    this.worker.on('failed', (job, err) => {
      if (!job) return;
      const attempts = job.attemptsMade;
      const max = job.opts.attempts ?? this.maxAttempts;
      const payload = job.data as ReplayJobPayload;
      // Final failure → the job is retained (removeOnFail: false) as the DLQ
      // record; emit a structured error so it surfaces in monitoring/alerts.
      if (attempts >= max) {
        this.structuredLogger.error(
          `Replay exhausted → DLQ [${payload.portName}] after ${attempts} attempts`,
          err,
          {
            operation: { name: `${payload.portName}:${payload.method}` },
            trace: { correlationId: payload.context?.correlationId },
            data: { jobId: job.id, attempts, dlq: QUEUE_NAME },
          },
        );
      }
    });

    this.logger.log(
      `Queue tier enabled (db=${connectionOpts.db}, concurrency=${this.concurrency}, attempts=${this.maxAttempts}, backoff=${this.backoffDelay}ms)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /**
   * Enqueue a replay job. Returns the BullMQ job id (PortQueuedException carries it).
   * Throws if the queue tier is disabled — the caller then falls back to cache/error.
   */
  async enqueue(payload: ReplayJobPayload): Promise<string> {
    if (!this.enabled || !this.queue) {
      throw new Error('Queue tier disabled (no Redis)');
    }
    const job = await this.queue.add('replay', payload, {
      attempts: this.maxAttempts,
      backoff: { type: 'exponential', delay: this.backoffDelay },
      removeOnComplete: true,
      removeOnFail: false, // retain as DLQ record for inspection
    });
    return job.id ?? 'unknown';
  }
}
