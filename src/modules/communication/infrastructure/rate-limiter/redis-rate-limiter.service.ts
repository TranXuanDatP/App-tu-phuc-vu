/**
 * Redis Rate Limiter Service (AC#1, #4 — FR55)
 *
 * App-only notifications (Pc 2026-07-13): no SMS/Zalo/email.
 * All notifications go through the App — push (FCM) + in-app inbox.
 *
 * Channel limits:
 *   Push:   50/day (FCM/APNs)
 *   In-App: ∞ (no limit — notification center in the App)
 *   ZNS/SMS/Email: disabled (0 = always rate limited)
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_SERVICE_TOKEN } from '@core/constants/tokens';
import type { ICacheService } from '@shared/caching/cache.interface';
import type { NotificationChannel } from '../../application/dtos/notification.dto';

const CHANNEL_LIMITS: Record<NotificationChannel, number> = {
  push: 50,
  in_app: Infinity,
  zns: 0,
  sms: 0,
  email: 0,
};

const FALLBACK_CHAIN: NotificationChannel[] = ['push', 'in_app'];

@Injectable()
export class RedisRateLimiterService {
  private readonly logger = new Logger(RedisRateLimiterService.name);

  constructor(
    @Inject(CACHE_SERVICE_TOKEN) private readonly cacheService: ICacheService,
  ) {}

  /**
   * Check if a notification is allowed for the given channel.
   * Uses atomic Redis INCR for concurrent safety.
   */
  async check(
    userId: string,
    channel: NotificationChannel,
  ): Promise<{ allowed: boolean; currentCount: number; limit: number }> {
    const limit = CHANNEL_LIMITS[channel];
    if (limit === Infinity) {
      return { allowed: true, currentCount: 0, limit: Infinity };
    }

    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const key = `ratelimit:notification:${userId}:${channel}:${date}`;
    const currentCount = await this.cacheService.incr(key);

    // Set TTL on first increment (24h) — no-op if key already has TTL
    if (currentCount === 1) {
      await this.cacheService.set(`ratelimit:notification:${userId}:${channel}:${date}:ttl`, 1, 86400);
    }

    const allowed = currentCount <= limit;

    if (!allowed) {
      this.logger.log(`Rate limited: ${channel} for ${userId} (${currentCount}/${limit})`);
    }

    return { allowed, currentCount, limit };
  }

  /**
   * Get the fallback chain for critical notifications.
   * App-only: Push (FCM) → In-App Inbox.
   */
  getFallbackChain(): NotificationChannel[] {
    return [...FALLBACK_CHAIN];
  }
}
