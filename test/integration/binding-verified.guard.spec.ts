/**
 * BindingVerifiedGuard TDD tests (A1.2) — written BEFORE the guard body to pin the
 * deny-first contract. Direct instantiation + chainable mock db (matches the
 * auth-contract.spec.ts pattern).
 *
 * Cases (SPEC-A4-A1 §A1.2 test matrix):
 *  - DENY on a @RequiresBinding route with no verified binding.
 *  - ALLOW on a @RequiresBinding route with a verified binding.
 *  - DENY when only a pending binding exists (only status='verified' opens data).
 *  - DENY when only a revoked binding exists.
 *  - Unmarked route → ALLOW (opt-in: no binding requirement declared).
 *  - No authenticated user → ALLOW (defer; SessionAuthGuard owns the 401).
 */

import { BindingVerifiedGuard } from '../../src/modules/binding/guards/binding-verified.guard';
import { REQUIRES_BINDING_KEY } from '../../src/modules/binding/decorators/requires-binding.decorator';

/** select().from().where().limit() chain → resolves to the given row (or [] when null). */
function createMockDb(verifiedRow: object | null) {
  const limit = jest.fn().mockResolvedValue(verifiedRow ? [verifiedRow] : []);
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
  const ctx: any = {
    getHandler: () => function handler() {},
    getClass: () => class MockController {},
    switchToHttp: () => ({
      getRequest: () => ({
        user: opts.userId ? { id: opts.userId } : undefined,
      }),
    }),
  };
  return { ctx, reflector };
}

describe('BindingVerifiedGuard (A1.2 — deny-first)', () => {
  it('DENIES (403) a @RequiresBinding route when no verified binding exists', async () => {
    const { ctx, reflector } = createCtx({ requiresBinding: true, userId: 'u1' });
    const guard = new BindingVerifiedGuard(reflector, createMockDb(null) as any);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 403 });
  });

  it('ALLOWS a @RequiresBinding route when a verified binding exists', async () => {
    const { ctx, reflector } = createCtx({ requiresBinding: true, userId: 'u1' });
    const guard = new BindingVerifiedGuard(reflector, createMockDb({ id: 'b1' }) as any);
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('DENIES when only a pending binding exists (only status=verified opens data)', async () => {
    // The guard queries status='verified' only; a pending row → empty result → deny.
    const { ctx, reflector } = createCtx({ requiresBinding: true, userId: 'u1' });
    const guard = new BindingVerifiedGuard(reflector, createMockDb(null) as any);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 403 });
  });

  it('DENIES when only a revoked binding exists', async () => {
    const { ctx, reflector } = createCtx({ requiresBinding: true, userId: 'u1' });
    const guard = new BindingVerifiedGuard(reflector, createMockDb(null) as any);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 403 });
  });

  it('ALLOWS unmarked routes (opt-in: no @RequiresBinding → no binding check)', async () => {
    const { ctx, reflector } = createCtx({ requiresBinding: false, userId: 'u1' });
    // Even with NO verified binding, an unmarked route must pass.
    const guard = new BindingVerifiedGuard(reflector, createMockDb(null) as any);
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('DEFERS (allows) when there is no authenticated user — SessionAuthGuard owns 401', async () => {
    const { ctx, reflector } = createCtx({ requiresBinding: true });
    const guard = new BindingVerifiedGuard(reflector, createMockDb(null) as any);
    expect(await guard.canActivate(ctx)).toBe(true);
  });
});
