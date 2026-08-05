/**
 * BindingRateLimiter (A1.4) — dual-ceiling brute-force lockout for the bind challenge.
 *
 * Two ceilings (both enforced, SPEC-A4-A1 §A1.4 / Fix 2):
 *  1. Per-(userId, customerRef): 3 fails in 15 min → lock this user out of THIS
 *     customerRef for 15 min.
 *  2. Per-customerRef GLOBAL (Fix 2): 10 fails from ANY userId in 1h → lock that
 *     customerRef for EVERY userId for 24h. This blocks the "create N accounts →
 *     3×N tries on one victim" attack that a per-user ceiling alone allows.
 *
 * Backed by ICacheService (Redis in prod, MemoryCacheService in dev). Counters use a
 * read-modify-write of a windowed {count, since} object — backend-agnostic and
 * deterministic in tests (ICacheService.incr has no TTL control via the interface, so
 * we don't rely on it). The non-atomic RMW is an acceptable approximation at the BFF
 * brute-force layer; Redis narrows the race. Lockout events are warn-logged (a full
 * audit table is A1.5, out of this batch).
 *
 * On a successful bind, only the per-(userId,customerRef) counter is cleared — the
 * per-customerRef GLOBAL counter is intentionally NOT reset (it tracks cross-user
 * attack patterns and simply expires by its window).
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_SERVICE_TOKEN } from '@core/constants/tokens';
import type { ICacheService } from '@core';

export type LockReason = 'user_ref' | 'customer_ref';

export interface LockState {
  locked: boolean;
  retryAfterSec?: number;
}

export interface FailureOutcome {
  lockedNow: boolean;
  reason?: LockReason;
  retryAfterSec?: number;
}

@Injectable()
export class BindingRateLimiter {
  private readonly logger = new Logger(BindingRateLimiter.name);

  // Per-(user, customer)
  private readonly USER_REF_LIMIT = 3;
  private readonly USER_REF_WINDOW_SEC = 15 * 60; // 15 min
  // Per-customer GLOBAL
  private readonly CUSTOMER_REF_LIMIT = 10;
  private readonly CUSTOMER_REF_WINDOW_SEC = 60 * 60; // 1h
  private readonly CUSTOMER_REF_LOCK_SEC = 24 * 60 * 60; // 24h

  constructor(@Inject(CACHE_SERVICE_TOKEN) private readonly cache: ICacheService) {}

  /** Is this (userId, customerRef) currently locked under either ceiling? */
  async checkLocked(userId: string, customerRef: string): Promise<LockState> {
    const userLockKey = this.userLockKey(userId, customerRef);
    if (await this.cache.get<number>(userLockKey)) {
      return { locked: true, retryAfterSec: await this.ttlSec(userLockKey) };
    }
    const custLockKey = this.custLockKey(customerRef);
    if (await this.cache.get<number>(custLockKey)) {
      return { locked: true, retryAfterSec: await this.ttlSec(custLockKey) };
    }
    return { locked: false };
  }

  /** Record a failed attempt; arm the relevant lock(s) when a ceiling is crossed. */
  async recordFailure(userId: string, customerRef: string): Promise<FailureOutcome> {
    // Ceiling 1 — per-(user, customer)
    const userCount = await this.bump(
      this.userFailKey(userId, customerRef),
      this.USER_REF_WINDOW_SEC,
    );
    if (userCount >= this.USER_REF_LIMIT) {
      await this.cache.set(
        this.userLockKey(userId, customerRef),
        1,
        this.USER_REF_WINDOW_SEC,
      );
      await this.cache.delete(this.userFailKey(userId, customerRef));
      this.logger.warn(
        `binding locked per-(user,customer) user=${userId} ref=${customerRef} after ${userCount} fails`,
      );
      return { lockedNow: true, reason: 'user_ref', retryAfterSec: this.USER_REF_WINDOW_SEC };
    }

    // Ceiling 2 — per-customer GLOBAL (Fix 2)
    const custCount = await this.bump(
      this.custFailKey(customerRef),
      this.CUSTOMER_REF_WINDOW_SEC,
    );
    if (custCount >= this.CUSTOMER_REF_LIMIT) {
      await this.cache.set(this.custLockKey(customerRef), 1, this.CUSTOMER_REF_LOCK_SEC);
      await this.cache.delete(this.custFailKey(customerRef));
      this.logger.warn(
        `binding locked per-customerRef GLOBAL ref=${customerRef} after ${custCount} fails (across users)`,
      );
      return {
        lockedNow: true,
        reason: 'customer_ref',
        retryAfterSec: this.CUSTOMER_REF_LOCK_SEC,
      };
    }
    return { lockedNow: false };
  }

  /** On success — clear the per-(user, customer) counter only (NOT the global one). */
  async clearFailures(userId: string, customerRef: string): Promise<void> {
    await this.cache.delete(this.userFailKey(userId, customerRef));
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Windowed counter bump: {count, since}; resets when the window has elapsed. */
  private async bump(key: string, windowSec: number): Promise<number> {
    const now = Date.now();
    const entry = await this.cache.get<{ count: number; since: number } | null>(key);
    if (entry && now - entry.since < windowSec * 1000) {
      const count = entry.count + 1;
      await this.cache.set(key, { count, since: entry.since }, windowSec);
      return count;
    }
    await this.cache.set(key, { count: 1, since: now }, windowSec);
    return 1;
  }

  private async ttlSec(key: string): Promise<number> {
    const t = await this.cache.ttl(key);
    return Math.max(t, 0);
  }

  private userFailKey(userId: string, customerRef: string) {
    return `bind:fail:user:${userId}:${customerRef}`;
  }
  private userLockKey(userId: string, customerRef: string) {
    return `bind:lock:user:${userId}:${customerRef}`;
  }
  private custFailKey(customerRef: string) {
    return `bind:fail:cust:${customerRef}`;
  }
  private custLockKey(customerRef: string) {
    return `bind:lock:cust:${customerRef}`;
  }
}
