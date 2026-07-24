import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { CACHE_SERVICE_TOKEN } from '@core/constants/tokens';
import type { ICacheService } from '@shared/caching/cache.interface';
import { RedisCacheService } from '@shared/caching/redis-cache.service';
import { SESSION_TTL_TOKEN } from '../../constants/tokens';
import type { ISessionStore } from '../session-store.interface';
import type { SessionEvent, SessionMetadata, ChannelType } from '../../dto/session-event.dto';
import { randomUUID } from 'crypto';

/**
 * Inline Lua script for atomic session event append.
 *
 * Originally loaded from scripts/session-append.lua, but inlined here
 * because Bun's `--compile` binary bundler does NOT include external
 * files — readFileSync would fail with ENOENT in production Docker.
 *
 * KEYS[1] = session:{userId}           (Hash — session metadata)
 * KEYS[2] = session:{userId}:events    (Sorted Set — session events)
 * ARGV[1] = event JSON string
 * ARGV[2] = TTL in seconds
 * ARGV[3] = score (timestamp ms)
 * ARGV[4] = updatedAt ISO 8601
 * ARGV[5] = userId
 * ARGV[6] = channel
 * ARGV[7] = sessionId UUID
 */
const SESSION_APPEND_LUA = `
local sessionKey = KEYS[1]
local eventsKey = KEYS[2]
local event = ARGV[1]
local ttl = tonumber(ARGV[2])
local score = ARGV[3]
local updatedAt = ARGV[4]
local userId = ARGV[5]
local channel = ARGV[6]
local sessionId = ARGV[7]

redis.call('ZADD', eventsKey, score, event)
redis.call('EXPIRE', eventsKey, ttl)
redis.call('HSETNX', sessionKey, 'sessionId', sessionId)
redis.call('HSETNX', sessionKey, 'userId', userId)
redis.call('HSETNX', sessionKey, 'channel', channel)
redis.call('HSETNX', sessionKey, 'createdAt', updatedAt)

local currentCount = tonumber(redis.call('HGET', sessionKey, 'eventCount') or '0')
redis.call('HSET', sessionKey, 'updatedAt', updatedAt, 'eventCount', tostring(currentCount + 1))
redis.call('EXPIRE', sessionKey, ttl)

return 1
`;

@Injectable()
export class RedisSessionStore implements ISessionStore, OnModuleInit {
  private readonly logger = new Logger(RedisSessionStore.name);
  private scriptSha: string | null = null;
  private readonly luaScript: string = SESSION_APPEND_LUA;

  constructor(
    @Inject(CACHE_SERVICE_TOKEN) private readonly cacheService: ICacheService,
    @Inject(SESSION_TTL_TOKEN) private readonly defaultTtl: number,
  ) {}

  async onModuleInit(): Promise<void> {
    const client = this.getRawClient();
    this.scriptSha = await client.scriptLoad(this.luaScript);
    this.logger.log(`Session Lua script loaded: SHA=${this.scriptSha}`);
  }

  async appendEvent(userId: string, event: SessionEvent, ttl?: number): Promise<void> {
    if (!this.scriptSha) {
      throw new Error('Session Lua script not loaded — cannot append event');
    }

    const client = this.getRawClient();
    const sessionKey = `session:${userId}`;
    const eventsKey = `session:${userId}:events`;
    const effectiveTtl = ttl ?? this.defaultTtl;
    const score = String(new Date(event.timestamp).getTime());
    const updatedAt = new Date().toISOString();
    const sessionId = randomUUID();

    try {
      // Try EVALSHA first (performance)
      await client.evalSha(this.scriptSha, {
        keys: [sessionKey, eventsKey],
        arguments: [
          JSON.stringify(event),
          String(effectiveTtl),
          score,
          updatedAt,
          userId,
          event.channel,
          sessionId,
        ],
      });
    } catch (error) {
      // Fallback to EVAL if script not loaded (NOSCRIPT error)
      if (String(error).includes('NOSCRIPT')) {
        this.logger.warn('EVALSHA NOSCRIPT — falling back to EVAL');
        await client.eval(this.luaScript, {
          keys: [sessionKey, eventsKey],
          arguments: [
            JSON.stringify(event),
            String(effectiveTtl),
            score,
            updatedAt,
            userId,
            event.channel,
            sessionId,
          ],
        });
        // Re-load SHA
        this.scriptSha = await client.scriptLoad(this.luaScript);
      } else {
        throw error;
      }
    }
  }

  async getSession(userId: string): Promise<SessionMetadata | null> {
    const client = this.getRawClient();
    const data = await client.hGetAll(`session:${userId}`);
    if (!data || Object.keys(data).length === 0) return null;
    return {
      sessionId: data.sessionId,
      userId: data.userId,
      channel: data.channel as ChannelType,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      eventCount: parseInt(data.eventCount || '0', 10),
    };
  }

  async getEvents(userId: string, from = 0, to = Infinity): Promise<SessionEvent[]> {
    const client = this.getRawClient();
    const rawEvents = await client.zRangeByScore(`session:${userId}:events`, from, to);

    const events: SessionEvent[] = [];
    for (const raw of rawEvents) {
      try {
        events.push(JSON.parse(raw as string) as SessionEvent);
      } catch {
        this.logger.warn(`Failed to parse session event for user ${userId}, skipping corrupted entry`);
      }
    }
    return events;
  }

  async sessionExists(userId: string): Promise<boolean> {
    const client = this.getRawClient();
    return (await client.exists(`session:${userId}`)) > 0;
  }

  private getRawClient() {
    return (this.cacheService as RedisCacheService).getClient();
  }
}
