/**
 * BindingVerifiedGuard tests (OPT-OUT: every authenticated route requires a binding unless
 * @SkipBindingVerified). Real MemoryCacheService so ciphertext-cache + DB-fallback are
 * exercised. Pins:
 *  - DEFAULT-DENY: an authenticated route with NO @SkipBindingVerified and no binding → 403.
 *  - @SkipBindingVerified → allowed (no binding check).
 *  - resolve binding, DECRYPT per-request, attach request.customer.customerId.
 *  - cache holds CIPHERTEXT only (never plaintext); cache HIT → 0 DB query; MISS → DB → warm.
 *  - no user → defer (allow); integrity (verified row, no customerId) → 500.
 */

import { Reflector } from '@nestjs/core';
import { MemoryCacheService } from '../../src/libs/shared/caching/memory-cache.service';
import { BindingVerifiedGuard } from '../../src/modules/binding/guards/binding-verified.guard';
import { SKIP_BINDING_VERIFIED_KEY } from '../../src/modules/binding/decorators/skip-binding-verified.decorator';
import { AuthController } from '../../src/modules/auth/infrastructure/http/auth.controller';

const b64 = (v: string) => Buffer.from(v).toString('base64');
const unb64 = (c: string) => Buffer.from(c, 'base64').toString('utf8');

function createMockDb(rows: any[] = []) {
  const limit = jest.fn().mockResolvedValue(rows);
  const where = jest.fn().mockReturnValue({ limit });
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });
  return { select };
}

function createCtx(opts: { skip?: boolean; userId?: string }) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) =>
      key === SKIP_BINDING_VERIFIED_KEY ? !!opts.skip : undefined,
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

describe('BindingVerifiedGuard (OPT-OUT — deny by default)', () => {
  let cache: MemoryCacheService;
  let pii: { decryptIfNeeded: jest.Mock };

  beforeEach(() => {
    cache = new MemoryCacheService({ cleanupInterval: 0 });
    pii = {
      decryptIfNeeded: jest.fn((c: string | null) => (c ? unb64(c) : null)),
      hashForLog: jest.fn(() => 'abcd1234'),
    };
  });

  it('DEFAULT-DENY: authenticated, not skipped, no binding → 403', async () => {
    const { ctx, reflector } = createCtx({ userId: 'u1' }); // skip=false
    const guard = new BindingVerifiedGuard(
      reflector,
      createMockDb([]) as any,
      cache as any,
      pii as any,
    );
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 403 });
  });

  it('@SkipBindingVerified → allowed WITHOUT a binding', async () => {
    const { ctx, reflector } = createCtx({ skip: true, userId: 'u1' });
    const guard = new BindingVerifiedGuard(
      reflector,
      createMockDb() as any,
      cache as any,
      pii as any,
    );
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('resolves binding (cache HIT), decrypts per-request, attaches request.customer', async () => {
    await cache.set(
      'bind:u1',
      {
        customerIdCipher: b64('QN-0912345'),
        customerRef: 'REF-001',
        verifiedAt: null,
        deviceInfo: null,
      },
      3600,
    );
    const { ctx, reflector, request } = createCtx({ userId: 'u1' });
    const guard = new BindingVerifiedGuard(
      reflector,
      createMockDb() as any,
      cache as any,
      pii as any,
    );
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(request.customer).toMatchObject({
      id: 'u1',
      customerId: 'QN-0912345',
      customerRef: 'REF-001',
    });
    // cache holds CIPHERTEXT — never the decrypted id
    const cached = await cache.get<{ customerIdCipher: string }>('bind:u1');
    expect(cached?.customerIdCipher).toBe(b64('QN-0912345'));
    expect(JSON.stringify(cached)).not.toContain('QN-0912345');
  });

  it('cache HIT → resolves with ZERO DB queries', async () => {
    await cache.set('bind:u1', {
      customerIdCipher: b64('X'),
      customerRef: 'R',
      verifiedAt: null,
      deviceInfo: null,
    }, 3600);
    const { ctx, reflector } = createCtx({ userId: 'u1' });
    const db = createMockDb();
    const guard = new BindingVerifiedGuard(
      reflector,
      db as any,
      cache as any,
      pii as any,
    );
    await guard.canActivate(ctx);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('cache MISS → DB fallback → warms cache with CIPHERTEXT', async () => {
    const { ctx, reflector } = createCtx({ userId: 'u1' });
    const db = createMockDb([
      {
        customerIdCipher: b64('QN-0777123'),
        customerRef: 'REF-003',
        verifiedAt: null,
        deviceInfo: 'dev',
      },
    ]);
    const guard = new BindingVerifiedGuard(
      reflector,
      db as any,
      cache as any,
      pii as any,
    );
    expect(await guard.canActivate(ctx)).toBe(true);
    const cached = await cache.get<{ customerIdCipher: string }>('bind:u1');
    expect(cached?.customerIdCipher).toBe(b64('QN-0777123'));
  });

  it('integrity: verified row with no customerId ciphertext → 500', async () => {
    const { ctx, reflector } = createCtx({ userId: 'u1' });
    const db = createMockDb([
      { customerIdCipher: null, customerRef: 'REF-X', verifiedAt: null, deviceInfo: null },
    ]);
    const guard = new BindingVerifiedGuard(
      reflector,
      db as any,
      cache as any,
      pii as any,
    );
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 500 });
  });

  it('no authenticated user → DEFER (allow)', async () => {
    const { ctx, reflector } = createCtx({}); // no userId
    const guard = new BindingVerifiedGuard(
      reflector,
      createMockDb() as any,
      cache as any,
      pii as any,
    );
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  // Guard-behavior test with the REAL Reflector + REAL AuthController metadata (not a
  // mocked reflector). Asserts the actual /auth/me handler is opted out — so an
  // authenticated, NOT-yet-bound session reaches it (mobile polls it post-OTP). If the
  // class-level @SkipBindingVerified is removed from AuthController, this flips to 403
  // and the post-OTP→bind dead loop returns. That regression is what this guards.
  it('AuthController.getMe is OPTED OUT — passes for a bound-less session (regression guard)', async () => {
    const guard = new BindingVerifiedGuard(
      new Reflector(),
      createMockDb([]) as any, // no binding row
      cache as any,             // no binding cache
      pii as any,
    );
    const request: any = { user: { id: 'u1' } }; // authenticated, NO binding
    const ctx: any = {
      getHandler: () => AuthController.prototype.getMe,
      getClass: () => AuthController,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    expect(await guard.canActivate(ctx)).toBe(true);
    // Onboarding route — guard must NOT attach request.customer (it's not customer-data).
    expect(request.customer).toBeUndefined();
  });
});
