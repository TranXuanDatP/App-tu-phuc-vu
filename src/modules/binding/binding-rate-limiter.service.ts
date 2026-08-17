/**
 * BindingRateLimiter (A1.4) — triple-ceiling brute-force lockout for the bind challenge.
 *
 * Three ceilings (all enforced, SPEC-A4-A1 §A1.4 / Fix 2 / Fix-3 condition (a)):
 *  1. Per-(userId, customerRef): 3 fails in 15 min → lock this user out of THIS
 *     customerRef for 15 min.
 *  2. Per-customerRef GLOBAL (Fix 2): 10 fails from ANY userId in 1h → lock that
 *     customerRef for EVERY userId for 24h. Blocks "create N accounts → 3×N tries
 *     on one victim".
 *  3. Per-userId TOTAL across ALL customerRefs (Fix-3 condition (a)): 5 fails in 15 min
 *     regardless of how many refs → lock this user out of bind ENTIRELY for 15 min.
 *     Blocks the dual of ceiling 2: "one account → N candidates → 3 tries each = 3×N".
 *     Required because bind-init N-match (W1 disambiguation, Fix 3) returns N
 *     candidates — without this ceiling one session gets 3×N secret guesses.
 *
 * Backed by ICacheService (Redis in prod, MemoryCacheService in dev). Counters use a
 * read-modify-write of a windowed {count, since} object — backend-agnostic and
 * deterministic in tests. The non-atomic RMW is an acceptable approximation at the
 * BFF brute-force layer; Redis narrows the race. Lockout audit rows (A1.5, binding_audit)
 * do BindingService ghi (caller giữ ip/deviceInfo); limiter chỉ warn-log — log user
 * dạng hash (PII không vào log) và không phụ thuộc DB.
 *
 * On a successful bind, the per-(userId,customerRef) AND per-user TOTAL counters are
 * cleared (success = strong "not an attacker" signal; keeping the total would lock a
 * legit household explorer who failed across refs before succeeding). The per-customerRef
 * GLOBAL counter is intentionally NOT reset (tracks cross-user patterns, expires by window).
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_SERVICE_TOKEN } from '@core/constants/tokens';
import type { ICacheService } from '@core';
import { PII_ENCRYPTION_SERVICE_TOKEN } from '@modules/auth/constants/tokens';
import { PiiEncryptionService } from '@modules/auth/infrastructure/persistence/encryption/pii-encryption.service';

export type LockReason = 'user_ref' | 'customer_ref' | 'session';

export interface LockState {
  locked: boolean;
  reason?: LockReason;
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

  // Ceiling 1 — per-(user, customer)
  private readonly USER_REF_LIMIT = 3;
  private readonly USER_REF_WINDOW_SEC = 15 * 60; // 15 min
  // Ceiling 2 — per-customer GLOBAL
  private readonly CUSTOMER_REF_LIMIT = 10;
  private readonly CUSTOMER_REF_WINDOW_SEC = 60 * 60; // 1h
  private readonly CUSTOMER_REF_LOCK_SEC = 24 * 60 * 60; // 24h
  // Ceiling 3 — per-user TOTAL across all customerRefs (Fix-3 condition (a): chặn 3×N)
  private readonly USER_TOTAL_LIMIT = 5;
  private readonly USER_TOTAL_WINDOW_SEC = 15 * 60; // 15 min
  private readonly USER_TOTAL_LOCK_SEC = 15 * 60; // 15 min

  constructor(
    @Inject(CACHE_SERVICE_TOKEN) private readonly cache: ICacheService,
    @Inject(PII_ENCRYPTION_SERVICE_TOKEN) private readonly pii: PiiEncryptionService,
  ) {}

  /** Is this (userId, customerRef) currently locked under any ceiling? */
  async checkLocked(userId: string, customerRef: string): Promise<LockState> {
    // Ceiling 3 first — a session-total lock bars this user from EVERY ref.
    const totalLockKey = this.userTotalLockKey(userId);
    if (await this.cache.get<number>(totalLockKey)) {
      return { locked: true, reason: 'session', retryAfterSec: await this.ttlSec(totalLockKey) };
    }
    const userLockKey = this.userLockKey(userId, customerRef);
    if (await this.cache.get<number>(userLockKey)) {
      return { locked: true, reason: 'user_ref', retryAfterSec: await this.ttlSec(userLockKey) };
    }
    const custLockKey = this.custLockKey(customerRef);
    if (await this.cache.get<number>(custLockKey)) {
      return { locked: true, reason: 'customer_ref', retryAfterSec: await this.ttlSec(custLockKey) };
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
    let userRefArmed = false;
    if (userCount >= this.USER_REF_LIMIT) {
      await this.cache.set(
        this.userLockKey(userId, customerRef),
        1,
        this.USER_REF_WINDOW_SEC,
      );
      await this.cache.delete(this.userFailKey(userId, customerRef));
      this.logger.warn(
        `binding locked per-(user,customer) user=${this.pii.hashForLog(userId)} ref=${customerRef} after ${userCount} fails`,
      );
      userRefArmed = true;
    }

    // Ceiling 2 — per-customer GLOBAL (Fix 2)
    const custCount = await this.bump(
      this.custFailKey(customerRef),
      this.CUSTOMER_REF_WINDOW_SEC,
    );
    let customerArmed = false;
    if (custCount >= this.CUSTOMER_REF_LIMIT) {
      await this.cache.set(this.custLockKey(customerRef), 1, this.CUSTOMER_REF_LOCK_SEC);
      await this.cache.delete(this.custFailKey(customerRef));
      this.logger.warn(
        `binding locked per-customerRef GLOBAL ref=${customerRef} after ${custCount} fails (across users)`,
      );
      customerArmed = true;
    }

    // Ceiling 3 — per-user TOTAL across all customerRefs (Fix-3 condition (a): chặn 3×N).
    // Bumped every fail regardless of which ref, so N candidates → at most USER_TOTAL_LIMIT
    // guesses per session, not 3×N.
    const totalCount = await this.bump(
      this.userTotalFailKey(userId),
      this.USER_TOTAL_WINDOW_SEC,
    );
    let sessionArmed = false;
    if (totalCount >= this.USER_TOTAL_LIMIT) {
      await this.cache.set(this.userTotalLockKey(userId), 1, this.USER_TOTAL_LOCK_SEC);
      await this.cache.delete(this.userTotalFailKey(userId));
      this.logger.warn(
        `binding locked per-user TOTAL user=${this.pii.hashForLog(userId)} after ${totalCount} fails (across refs)`,
      );
      sessionArmed = true;
    }

    // Return the STRONGEST ceiling that armed (session > customer_ref > user_ref).
    if (sessionArmed) return { lockedNow: true, reason: 'session', retryAfterSec: this.USER_TOTAL_LOCK_SEC };
    if (customerArmed) return { lockedNow: true, reason: 'customer_ref', retryAfterSec: this.CUSTOMER_REF_LOCK_SEC };
    if (userRefArmed) return { lockedNow: true, reason: 'user_ref', retryAfterSec: this.USER_REF_WINDOW_SEC };
    return { lockedNow: false };
  }

  /** On success — clear the per-(user, customer) counter AND the per-user TOTAL counter
   *  (a successful bind is a strong "not an attacker" signal; keeping the total would
   *  session-lock a legit household explorer who failed a few times across refs before
   *  succeeding). The per-customerRef GLOBAL counter is intentionally NOT reset (it
   *  tracks cross-user attack patterns and expires by its window). */
  async clearFailures(userId: string, customerRef: string): Promise<void> {
    await this.cache.delete(this.userFailKey(userId, customerRef));
    await this.cache.delete(this.userTotalFailKey(userId));
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
  private userTotalFailKey(userId: string) {
    return `bind:fail:user_total:${userId}`;
  }
  private userTotalLockKey(userId: string) {
    return `bind:lock:user_total:${userId}`;
  }
}
