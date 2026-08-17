/**
 * BindingRateLimiter tests (A1.4) — triple-ceiling lockout, isolated.
 *
 * Real MemoryCacheService so the windowed-counter + lock semantics are exercised.
 * Covers the SPEC-A4-A1 §A1.4 matrix:
 *  - per-(user,customer): 3 fails → lock (15m).
 *  - per-customer GLOBAL (Fix 2): 10 fails across MANY users → lock for ALL (24h).
 *  - per-user TOTAL (Fix-3 cond. a): 5 fails across MANY refs → lock user entirely (15m).
 *  - clearFailures resets only the per-(user,customer) counter.
 */

import { MemoryCacheService } from '../../src/libs/shared/caching/memory-cache.service';
import { BindingRateLimiter } from '../../src/modules/binding/binding-rate-limiter.service';

describe('BindingRateLimiter (A1.4 — triple ceiling)', () => {
  let rl: BindingRateLimiter;

  beforeEach(() => {
    rl = new BindingRateLimiter(
      new MemoryCacheService({ cleanupInterval: 0 }) as any,
      // PII log remediation: limiter warn-log user dạng hash 8-char.
      { hashForLog: jest.fn(() => 'abcd1234') } as any,
    );
  });

  it('per-(user,ref): not locked at 2 fails; locks on the 3rd', async () => {
    expect((await rl.recordFailure('u1', 'REF-001')).lockedNow).toBe(false);
    expect((await rl.recordFailure('u1', 'REF-001')).lockedNow).toBe(false);
    const third = await rl.recordFailure('u1', 'REF-001');
    expect(third.lockedNow).toBe(true);
    expect(third.reason).toBe('user_ref');

    const lock = await rl.checkLocked('u1', 'REF-001');
    expect(lock.locked).toBe(true);
    expect(lock.retryAfterSec).toBeGreaterThan(0);
  });

  it('per-(user,ref) lock is scoped to that (user,ref) — a different ref is unaffected', async () => {
    await rl.recordFailure('u1', 'REF-001');
    await rl.recordFailure('u1', 'REF-001');
    await rl.recordFailure('u1', 'REF-001'); // locks u1↔REF-001
    expect((await rl.checkLocked('u1', 'REF-002')).locked).toBe(false);
    expect((await rl.checkLocked('u2', 'REF-001')).locked).toBe(false);
  });

  it('clearFailures resets the per-(user,ref) counter so 3 fresh fails are needed again', async () => {
    await rl.recordFailure('u1', 'REF-001');
    await rl.recordFailure('u1', 'REF-001'); // 2 fails
    await rl.clearFailures('u1', 'REF-001');
    // counter reset → 2 more fails must NOT lock (needs 3 from zero)
    expect((await rl.recordFailure('u1', 'REF-001')).lockedNow).toBe(false);
    expect((await rl.recordFailure('u1', 'REF-001')).lockedNow).toBe(false);
    expect((await rl.recordFailure('u1', 'REF-001')).lockedNow).toBe(true);
  });

  it('per-customer GLOBAL (Fix 2): 10 fails across MANY users locks that ref for ALL', async () => {
    // 5 users × 2 fails each = 10 global fails (each user stays under their per-user 3).
    // The 10th fail arms the global customer lock.
    let last;
    for (const u of ['a', 'b', 'c', 'd', 'e']) {
      await rl.recordFailure(u, 'REF-VICTIM');
      last = await rl.recordFailure(u, 'REF-VICTIM');
    }
    expect(last!.lockedNow).toBe(true);
    expect(last!.reason).toBe('customer_ref');

    // A brand-new attacker account is ALSO locked out of the victim (Fix 2).
    const freshUser = await rl.checkLocked('newuser', 'REF-VICTIM');
    expect(freshUser.locked).toBe(true);
    expect(freshUser.retryAfterSec).toBeGreaterThan(0);
  });

  it('a single account cannot exhaust the global ceiling on its own (per-user stops it at 3)', async () => {
    // One account fails repeatedly → it gets per-user locked at 3, contributing only 2
    // to the global counter (the 3rd returns early). The global ceiling is NOT reached.
    await rl.recordFailure('only', 'REF-X');
    await rl.recordFailure('only', 'REF-X');
    const r3 = await rl.recordFailure('only', 'REF-X');
    expect(r3.lockedNow).toBe(true);
    expect(r3.reason).toBe('user_ref');
    // Global customer lock NOT armed for REF-X (needs 10 across users).
    expect((await rl.checkLocked('someoneElse', 'REF-X')).locked).toBe(false);
  });

  // Ceiling 3 — per-user TOTAL across all customerRefs (Fix-3 condition (a): chặn 3×N).
  it('per-user TOTAL: N candidate → 3×N blocked (5 fails across refs → session lock)', async () => {
    // One account brute-forces across disambiguation candidates (household multi-ref).
    // 2 fails on REF-A + 2 on REF-B = 4 total (under per-ref 3, under total 5).
    await rl.recordFailure('u1', 'REF-A');
    await rl.recordFailure('u1', 'REF-A');
    await rl.recordFailure('u1', 'REF-B');
    await rl.recordFailure('u1', 'REF-B');
    expect((await rl.checkLocked('u1', 'REF-A')).locked).toBe(false);
    expect((await rl.checkLocked('u1', 'REF-C')).locked).toBe(false);

    // 5th fail (REF-C) arms the session-total lock — even though REF-C has only 1 fail.
    const fifth = await rl.recordFailure('u1', 'REF-C');
    expect(fifth.lockedNow).toBe(true);
    expect(fifth.reason).toBe('session');

    // User now locked out of EVERY ref, not just the one that tipped the total.
    expect((await rl.checkLocked('u1', 'REF-A')).locked).toBe(true);
    expect((await rl.checkLocked('u1', 'REF-A')).reason).toBe('session');
    expect((await rl.checkLocked('u1', 'REF-NEW')).locked).toBe(true);
  });

  it('per-user TOTAL is scoped to that user — a different user is unaffected', async () => {
    for (const ref of ['REF-A', 'REF-B', 'REF-C', 'REF-D', 'REF-E']) {
      await rl.recordFailure('u1', ref); // 5 fails across refs → u1 session-locked
    }
    expect((await rl.checkLocked('u1', 'REF-A')).locked).toBe(true);
    // u2 can still bind — the total is per-user, not global.
    expect((await rl.checkLocked('u2', 'REF-A')).locked).toBe(false);
  });

  it('clearFailures clears the per-user TOTAL — success resets the cross-ref budget', async () => {
    // 4 fails across refs → total=4 (one away from session-lock).
    await rl.recordFailure('u1', 'REF-A');
    await rl.recordFailure('u1', 'REF-A');
    await rl.recordFailure('u1', 'REF-B');
    await rl.recordFailure('u1', 'REF-B');
    // A successful bind on REF-A clears per-(u1,REF-A) AND the per-user total.
    await rl.clearFailures('u1', 'REF-A');

    // Now 4 fresh fails on NEW refs must NOT session-lock (would lock at 4 if total wasn't cleared).
    await rl.recordFailure('u1', 'REF-C');
    await rl.recordFailure('u1', 'REF-C');
    await rl.recordFailure('u1', 'REF-D');
    const fourth = await rl.recordFailure('u1', 'REF-D');
    expect(fourth.lockedNow).toBe(false); // total=4 since clear — under limit 5
    // 5th since clear → session-lock.
    expect((await rl.recordFailure('u1', 'REF-C')).lockedNow).toBe(true);
  });

  it('PII: lockout warn-log ghi user dạng HASH, không phải raw userId', async () => {
    const warnSpy = jest.spyOn((rl as any).logger, 'warn').mockImplementation(() => undefined);
    await rl.recordFailure('u-raw-secret-9', 'REF-001');
    await rl.recordFailure('u-raw-secret-9', 'REF-001');
    await rl.recordFailure('u-raw-secret-9', 'REF-001'); // 3rd fail → arm → warn
    const msgs = warnSpy.mock.calls.map((c) => String(c[0])).join(' | ');
    expect(msgs).toContain('user=abcd1234');
    expect(msgs).not.toContain('u-raw-secret-9');
    warnSpy.mockRestore();
  });

});
