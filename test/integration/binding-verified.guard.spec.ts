/**
 * BindingVerifiedGuard tests (A1.2 deny-first + A2 foundation: resolve+decrypt+attach).
 *
 * Real MemoryCacheService so the ciphertext-cache + DB-fallback paths are exercised. Pins:
 *  - DENY (403) when no verified binding.
 *  - resolve binding, DECRYPT per-request, attach request.customer.customerId (decrypted).
 *  - cache holds CIPHERTEXT only (redline #1) — never the decrypted id.
 *  - cache HIT → 0 DB query; cache MISS → DB → warm cache.
 *  - verified row but customerId missing → 500 integrity (not silent).
 *  - unmarked route / no user → defer/allow.
 */

import { MemoryCacheService } from '../../src/libs/shared/caching/memory-cache.service';
import { BindingVerifiedGuard } from '../../src/modules/binding/guards/binding-verified.guard';
import { REQUIRES_BINDING_KEY } from '../../src/modules/binding/decorators/requires-binding.decorator';

// Opaque, reversible toy cipher (base64) so the "cache holds ciphertext, not plaintext"
// assertion is meaningful — a real AES-256-GCM ciphertext is likewise opaque.
const b64 = (v: string) => Buffer.from(v).toString('base64');
const unb64 = (c: string) => Buffer.from(c, 'base64').toString('utf8');

/** select().from().where().limit() → resolves to the given rows. */
function createMockDb(rows: any[] = []) {
  const limit = jest.fn().mockResolvedValue(rows);
  const where = jest.fn().mockReturnValue({ limit });
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });
  return { select };
}

function createCtx(opts: { requiresBinding: boolean; userId?: string }) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) =>
      key === REQUIRES_BINDING_KEY ? opts.requiresBinding : undefined,
    ),
  } as any;
  const request: any = { user: opts.userId ? { id: opts.userId } : undefined };
  const ctx: any = {
    getHandler: () => function handler() {},
    getClass: () => class MockController {},
    switchToHttp: () => ({ getRequest: () => request }),
  };
  return { ctx, reflector, request };
}

describe('BindingVerifiedGuard (deny-first + A2 foundation)', () => {
  let cache: MemoryCacheService;
  let pii: { decryptIfNeeded: jest.Mock };

  beforeEach(() => {
    cache = new MemoryCacheService({ cleanupInterval: 0 });
    pii = { decryptIfNeeded: jest.fn((c: string | null) => (c ? unb64(c) : null)) };
  });

  it('DENIES (403) when no verified binding (cache miss + DB empty)', async () => {
    const { ctx, reflector } = createCtx({ requiresBinding: true, userId: 'u1' });
    const guard = new BindingVerifiedGuard(reflector, createMockDb([]) as any, cache as any, pii as any);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 403 });
  });

  it('resolves binding (cache HIT), decrypts per-request, attaches request.customer', async () => {
    await cache.set('bind:u1', {
      customerIdCipher: b64('QN-0912345'),
      customerRef: 'REF-001',
      verifiedAt: null,
      deviceInfo: null,
    }, 3600);
    const { ctx, reflector, request } = createCtx({ requiresBinding: true, userId: 'u1' });
    const guard = new BindingVerifiedGuard(reflector, createMockDb() as any, cache as any, pii as any);

    expect(await guard.canActivate(ctx)).toBe(true);
    // decrypted id lands on the request (plaintext in memory only)
    expect(request.customer).toMatchObject({ id: 'u1', customerId: 'QN-0912345', customerRef: 'REF-001' });
    // cache still holds CIPHERTEXT — never the decrypted id
    const cached = await cache.get<{ customerIdCipher: string }>('bind:u1');
    expect(cached?.customerIdCipher).toBe(b64('QN-0912345'));
    expect(JSON.stringify(cached)).not.toContain('QN-0912345');
  });

  it('cache HIT → resolves with ZERO DB queries', async () => {
    await cache.set('bind:u1', { customerIdCipher: b64('X'), customerRef: 'R', verifiedAt: null, deviceInfo: null }, 3600);
    const { ctx, reflector } = createCtx({ requiresBinding: true, userId: 'u1' });
    const db = createMockDb();
    const guard = new BindingVerifiedGuard(reflector, db as any, cache as any, pii as any);
    await guard.canActivate(ctx);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('cache MISS → DB fallback → warms cache with CIPHERTEXT', async () => {
    const { ctx, reflector } = createCtx({ requiresBinding: true, userId: 'u1' });
    const db = createMockDb([
      { customerIdCipher: b64('QN-0777123'), customerRef: 'REF-003', verifiedAt: null, deviceInfo: 'dev' },
    ]);
    const guard = new BindingVerifiedGuard(reflector, db as any, cache as any, pii as any);

    expect(await guard.canActivate(ctx)).toBe(true);

    const cached = await cache.get<{ customerIdCipher: string }>('bind:u1');
    expect(cached?.customerIdCipher).toBe(b64('QN-0777123')); // ciphertext, not plaintext
  });

  it('returns 500 (integrity) when a verified row has no customerId ciphertext', async () => {
    const { ctx, reflector } = createCtx({ requiresBinding: true, userId: 'u1' });
    const db = createMockDb([
      { customerIdCipher: null, customerRef: 'REF-X', verifiedAt: null, deviceInfo: null },
    ]);
    const guard = new BindingVerifiedGuard(reflector, db as any, cache as any, pii as any);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 500 });
  });

  it('ALLOWS unmarked routes (opt-in: no @RequiresBinding → no check)', async () => {
    const { ctx, reflector } = createCtx({ requiresBinding: false, userId: 'u1' });
    const guard = new BindingVerifiedGuard(reflector, createMockDb() as any, cache as any, pii as any);
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('DEFERS (allows) when there is no authenticated user', async () => {
    const { ctx, reflector } = createCtx({ requiresBinding: true });
    const guard = new BindingVerifiedGuard(reflector, createMockDb() as any, cache as any, pii as any);
    expect(await guard.canActivate(ctx)).toBe(true);
  });
});
