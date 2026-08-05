/**
 * BindingRateLimiter tests (A1.4) — dual-ceiling lockout, isolated.
 *
 * Real MemoryCacheService so the windowed-counter + lock semantics are exercised.
 * Covers the SPEC-A4-A1 §A1.4 matrix:
 *  - per-(user,customer): 3 fails → lock (15m).
 *  - per-customer GLOBAL (Fix 2): 10 fails across MANY users → lock for ALL (24h).
 *  - clearFailures resets only the per-(user,customer) counter.
 */

import { MemoryCacheService } from '../../src/libs/shared/caching/memory-cache.service';
import { BindingRateLimiter } from '../../src/modules/binding/binding-rate-limiter.service';

describe('BindingRateLimiter (A1.4 — dual ceiling)', () => {
  let rl: BindingRateLimiter;

  beforeEach(() => {
    rl = new BindingRateLimiter(
      new MemoryCacheService({ cleanupInterval: 0 }) as any,
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
});
