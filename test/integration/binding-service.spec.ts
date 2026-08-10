/**
 * BindingService contract tests (A1.3 + A1.4 integration).
 *
 * Exercises the real MemoryCacheService + real BindingRateLimiter (so session-scoping
 * and lockout are exercised end-to-end), with mocked customer-service client, db chain
 * and PII service. Pins the Fix 1 invariants (session phone, foreign-ref rejection) and
 * the verify success/failure/lockout paths.
 */

import { MemoryCacheService } from '../../src/libs/shared/caching/memory-cache.service';
import { BindingService } from '../../src/modules/binding/binding.service';
import { BindingRateLimiter } from '../../src/modules/binding/binding-rate-limiter.service';
import { ValidationException } from '../../src/libs/core/common/exceptions/validation.exception';
import type {
  CustomerServiceClient,
  ResolveResult,
} from '../../src/modules/account/clients/customer-service.client';

// ── mock db: select().from().where().limit() + update/insert ──────────────────
function createMockDb(selectRows: any[] = []) {
  const limit = jest.fn().mockResolvedValue(selectRows);
  const whereSelect = jest.fn().mockReturnValue({ limit });
  const from = jest.fn().mockReturnValue({ where: whereSelect });
  const select = jest.fn().mockReturnValue({ from });
  const whereUpdate = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn().mockReturnValue({ where: whereUpdate });
  const update = jest.fn().mockReturnValue({ set });
  const insertValues = jest.fn().mockResolvedValue(undefined);
  const insert = jest.fn().mockReturnValue({ values: insertValues });
  return { select, update, insert, insertValues, whereUpdate };
}

const VALID_BODY = {
  customerRef: 'REF-001',
  secretType: 'last_invoice_amount' as const,
  secretValue: '247500',
};

describe('BindingService (A1.3 + A1.4)', () => {
  let cache: MemoryCacheService;
  let rateLimiter: BindingRateLimiter;
  let customerService: jest.Mocked<CustomerServiceClient>;
  let pii: { encryptIfNeeded: jest.Mock };
  const SESSION_ID = 'sess-1';

  beforeEach(() => {
    // cleanupInterval:0 so no lingering timer keeps the jest process alive.
    cache = new MemoryCacheService({ cleanupInterval: 0 });
    rateLimiter = new BindingRateLimiter(cache);
    customerService = {
      resolve: jest.fn(),
      verify: jest.fn(),
      profile: jest.fn(),
      resolveChannel: jest.fn(),
    };
    pii = { encryptIfNeeded: jest.fn((v: string) => Buffer.from(v).toString('base64')) };
  });

  // ── bind-init (Fix 1: session phone, server-side) ──────────────────────────
  describe('bindInit', () => {
    it('resolves the SESSION phone (never client input) and stashes candidates', async () => {
      const db = createMockDb([{ phoneNumber: '+84901234567' }]);
      const one: ResolveResult = {
        status: 'one',
        customerRef: 'REF-001',
        maskedHint: 'Nguyễn V*** • 12 Lê Lợi, Hải Châu',
      };
      customerService.resolve.mockResolvedValue(one);
      const service = new BindingService(
        customerService as any,
        db as any,
        cache as any,
        pii as any,
        rateLimiter,
      );

      const result = await service.bindInit('user-1', SESSION_ID);

      expect(result).toEqual(one);
      // resolve was called with the SESSION phone read from the identity row, not a body.
      expect(customerService.resolve).toHaveBeenCalledWith('+84901234567');
      // the resolve result is stashed for this session (bind provenance check).
      expect(await cache.get<ResolveResult>(`bind:init:${SESSION_ID}`)).toEqual(one);
    });

    it('returns {status:"none"} when the identity has no phone', async () => {
      const db = createMockDb([]); // no user row
      const service = new BindingService(
        customerService as any,
        db as any,
        cache as any,
        pii as any,
        rateLimiter,
      );
      expect(await service.bindInit('user-1', SESSION_ID)).toEqual({ status: 'none' });
      expect(customerService.resolve).not.toHaveBeenCalled();
    });
  });

  // ── bind (Fix 1: session-scoped customerRef) ───────────────────────────────
  describe('bind — Fix 1 session scoping', () => {
    it('rejects with 400 when no bind-init was called for this session', async () => {
      const service = new BindingService(
        customerService as any,
        createMockDb() as any,
        cache as any,
        pii as any,
        rateLimiter,
      );
      await expect(
        service.bind('user-1', SESSION_ID, VALID_BODY, null),
      ).rejects.toThrow(ValidationException);
      expect(customerService.verify).not.toHaveBeenCalled();
    });

    it('rejects with 400 a FOREIGN customerRef not in this session resolve', async () => {
      const db = createMockDb([{ phoneNumber: '+84901234567' }]);
      customerService.resolve.mockResolvedValue({
        status: 'one',
        customerRef: 'REF-001',
        maskedHint: 'x',
      });
      const service = new BindingService(
        customerService as any,
        db as any,
        cache as any,
        pii as any,
        rateLimiter,
      );
      await service.bindInit('user-1', SESSION_ID); // seeds REF-001 for this session

      await expect(
        service.bind('user-1', SESSION_ID, { ...VALID_BODY, customerRef: 'REF-EVIL' }, null),
      ).rejects.toThrow(ValidationException);
      // verify never reached for a foreign ref.
      expect(customerService.verify).not.toHaveBeenCalled();
    });
  });

  // ── bind — verify success ──────────────────────────────────────────────────
  describe('bind — verify success', () => {
    it('writes an encrypted binding and returns {bound:true, customerId}', async () => {
      const db = createMockDb([]); // existing-check empty → insert path
      customerService.verify.mockResolvedValue({ verified: true });
      customerService.profile.mockResolvedValue({
        customerId: 'QN-0912345',
        fullName: 'Nguyễn Văn Nam',
        classification: 'sinh_hoat',
        address: { street: '12 Lê Lợi', ward: 'Hải Châu 1', district: 'Hải Châu', city: 'Đà Nẵng', fullAddress: '12 Lê Lợi, Hải Châu 1, Hải Châu, Đà Nẵng' },
        contactInfo: { phone: '+84901234567', email: null, contactAddress: null },
        status: 'active',
      });
      const service = new BindingService(
        customerService as any,
        db as any,
        cache as any,
        pii as any,
        rateLimiter,
      );
      // Seed the bind-init token directly — bindInit's session-phone read is covered
      // by the bindInit tests above; here we isolate bind() against a seeded session.
      await cache.set(
        `bind:init:${SESSION_ID}`,
        { status: 'one', customerRef: 'REF-001', maskedHint: 'x' },
        300,
      );

      const result = await service.bind('user-1', SESSION_ID, VALID_BODY, 'device-xyz');

      expect(result).toEqual({ bound: true, customerId: 'QN-0912345' });
      // customerId ENCRYPTED at rest (base64 toy cipher — opaque, reversible).
      const cipher = Buffer.from('QN-0912345').toString('base64');
      expect(pii.encryptIfNeeded).toHaveBeenCalledWith('QN-0912345');
      // insert path (no existing row); the binding object carries the ENCRYPTED id.
      expect(db.insertValues).toHaveBeenCalledTimes(1);
      const row = db.insertValues.mock.calls[0][0];
      expect(row).toMatchObject({
        userId: 'user-1',
        customerRef: 'REF-001',
        customerId: cipher,
        status: 'verified',
        factorUsed: 'last_invoice_amount',
        deviceInfo: 'device-xyz',
      });
      // init token is single-use → consumed after a successful bind.
      expect(await cache.get(`bind:init:${SESSION_ID}`)).toBeNull();
      // guard binding cache warmed with CIPHERTEXT (redline #1) — never plaintext.
      const warmed = await cache.get<{ customerIdCipher: string }>(`bind:user-1`);
      expect(warmed?.customerIdCipher).toBe(cipher);
      expect(JSON.stringify(warmed)).not.toContain('QN-0912345');
    });
  });

  // ── bind — verify failure + lockout (A1.4) ─────────────────────────────────
  describe('bind — failure & triple-ceiling lockout', () => {
    it('returns {bound:false} on a wrong secret and locks per-(user,ref) after 3 fails', async () => {
      const db = createMockDb([{ phoneNumber: '+84901234567' }]);
      customerService.resolve.mockResolvedValue({
        status: 'one',
        customerRef: 'REF-001',
        maskedHint: 'x',
      });
      customerService.verify.mockResolvedValue({ verified: false });
      const service = new BindingService(
        customerService as any,
        db as any,
        cache as any,
        pii as any,
        rateLimiter,
      );
      await service.bindInit('user-1', SESSION_ID);

      // Two fails are tolerated as {bound:false}...
      expect(await service.bind('user-1', SESSION_ID, VALID_BODY, null)).toEqual({ bound: false });
      // re-seed init (it survives — only deleted on success)
      expect(await service.bind('user-1', SESSION_ID, VALID_BODY, null)).toEqual({ bound: false });

      // ...the 3rd fail crosses the per-(user,ref) ceiling → LockoutException. Its
      // code + reason + retryAfterSec ride in `details` (BaseException path) so the
      // global filter passes them through to the wire body — NOT stripped like the old
      // raw HttpException throw. The mobile branches UX on details.reason.
      await expect(
        service.bind('user-1', SESSION_ID, VALID_BODY, null),
      ).rejects.toMatchObject({
        code: 'BINDING_LOCKED',
        details: { reason: 'user_ref', retryAfterSec: expect.any(Number) },
      });

      // Subsequent attempts are locked BEFORE verify (even with correct secret).
      customerService.verify.mockResolvedValueOnce({ verified: true });
      await expect(
        service.bind('user-1', SESSION_ID, VALID_BODY, null),
      ).rejects.toMatchObject({
        code: 'BINDING_LOCKED',
        details: { reason: 'user_ref' },
      });
      expect(customerService.verify).toHaveBeenCalledTimes(3); // 3 fails only — 4th was pre-locked
    });
  });
});
