/**
 * BindingService.bindRegister tests (A2 register→bind unification, SPEC-binding §4).
 *
 * Pins the two reject points + the create+bind happy path:
 *  - reject #1: re-resolve finds an existing customer → 409, no create, no binding.
 *  - reject #2: create conflict (race tail) → 409, NEVER auto-bind.
 *  - success: resolve='none' → create → verified binding inserted (creation=proof) +
 *    cache warmed with ciphertext.
 *
 * Real MockCustomerServiceClient for resolve/create consistency (tests 1-3); a jest-mock
 * client for the race tail (resolve='none' but create throws — tests 4).
 */

import { MemoryCacheService } from '../../src/libs/shared/caching/memory-cache.service';
import { BindingService } from '../../src/modules/binding/binding.service';
import { BindingRateLimiter } from '../../src/modules/binding/binding-rate-limiter.service';
import { MockCustomerServiceClient } from '../../src/modules/account/clients/customer-service-mock.client';
import {
  ConflictException,
  ValidationException,
} from '../../src/libs/core/common/exceptions';

const PROFILE = {
  fullName: 'New Customer',
  classification: 'sinh_hoat' as const,
  address: { street: '1 Lê Lợi', ward: 'An Hải', district: 'Sơn Trà', city: 'Đà Nẵng' },
  email: null,
};

/** db mock whose select().limit() returns successive queued results (getSessionPhone, then upsert existing-check). */
function mockDb(selectResults: any[][]) {
  let i = 0;
  const limit = jest.fn().mockImplementation(() => Promise.resolve(selectResults[i++] ?? []));
  const where = jest.fn().mockReturnValue({ limit });
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });
  const insertValues = jest.fn().mockResolvedValue(undefined);
  const insert = jest.fn().mockReturnValue({ values: insertValues });
  return { select, insert, insertValues };
}

describe('BindingService.bindRegister (register→bind, resolve-gated)', () => {
  let cache: MemoryCacheService;
  let rateLimiter: BindingRateLimiter;
  const pii = {
    encryptIfNeeded: jest.fn((v: string) => Buffer.from(v).toString('base64')),
    hashForLog: jest.fn(() => 'abcd1234'), // PII log remediation — hash 8-char
  };

  beforeEach(() => {
    cache = new MemoryCacheService({ cleanupInterval: 0 });
    rateLimiter = new BindingRateLimiter(cache as any, pii as any);
    pii.encryptIfNeeded.mockClear();
  });

  // ── happy path ─────────────────────────────────────────────────────────────
  it('resolve=none → create → verified binding inserted + cache warmed (ciphertext)', async () => {
    const customerService = new MockCustomerServiceClient();
    // select #1 (getSessionPhone) → phone; select #2 (upsert existing-check) → [] (insert path)
    const db = mockDb([[{ phoneNumber: '+84900000099' }], []]);
    const service = new BindingService(
      customerService as any,
      db as any,
      cache as any,
      pii as any,
      rateLimiter,
    );

    const result = await service.bindRegister('user-1', 'sess-1', PROFILE, 'dev-x');

    expect(result.bound).toBe(true);
    expect(result.customerId).toMatch(/^APP-\d{6}$/);
    // binding inserted with status verified, factorUsed=self_registration
    expect(db.insertValues).toHaveBeenCalledTimes(1);
    expect(db.insertValues.mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      status: 'verified',
      factorUsed: 'self_registration',
      deviceInfo: 'dev-x',
      customerId: expect.any(String), // ciphertext
    });
    // guard cache warmed with CIPHERTEXT (not plaintext)
    const warmed = await cache.get<{ customerIdCipher: string }>('bind:user-1');
    expect(warmed?.customerIdCipher).toBe(Buffer.from(result.customerId!).toString('base64'));
    expect(JSON.stringify(warmed)).not.toContain(result.customerId);
  });

  // ── reject #1 ──────────────────────────────────────────────────────────────
  it('reject #1: re-resolve finds existing customer → 409, no create, no binding', async () => {
    const customerService = new MockCustomerServiceClient();
    const createSpy = jest.spyOn(customerService, 'create');
    // +84987654321 resolves to seed REF-001 (status 'one')
    const db = mockDb([[{ phoneNumber: '+84987654321' }]]);
    const service = new BindingService(
      customerService as any,
      db as any,
      cache as any,
      pii as any,
      rateLimiter,
    );

    await expect(
      service.bindRegister('user-1', 'sess-1', PROFILE, null),
    ).rejects.toThrow(ConflictException);

    expect(createSpy).not.toHaveBeenCalled(); // rejected before create
    expect(db.insertValues).not.toHaveBeenCalled(); // no binding
  });

  // ── reject #2 (race tail) ──────────────────────────────────────────────────
  it('reject #2: create conflict (race tail) → 409, NEVER auto-bind', async () => {
    // Race: resolve says 'none' but create throws Conflict (phone appeared in the khe).
    const customerService = {
      resolve: jest.fn().mockResolvedValue({ status: 'none' }),
      create: jest.fn().mockRejectedValue(
        new ConflictException('exists', 'CUSTOMER_PHONE_EXISTS'),
      ),
      verify: jest.fn(),
      profile: jest.fn(),
      resolveChannel: jest.fn(),
    };
    const db = mockDb([[{ phoneNumber: '+84900000099' }], []]);
    const service = new BindingService(
      customerService as any,
      db as any,
      cache as any,
      pii as any,
      rateLimiter,
    );

    await expect(
      service.bindRegister('user-1', 'sess-1', PROFILE, null),
    ).rejects.toThrow(ConflictException);

    expect(customerService.create).toHaveBeenCalledTimes(1); // create was attempted
    expect(db.insertValues).not.toHaveBeenCalled(); // …but NO binding inserted (no auto-bind)
    const warmed = await cache.get('bind:user-1');
    expect(warmed).toBeNull(); // cache not warmed either
  });

  // ── no phone ───────────────────────────────────────────────────────────────
  it('throws ValidationException when the identity has no verified phone', async () => {
    const customerService = new MockCustomerServiceClient();
    const db = mockDb([[]]); // no user row → no phone
    const service = new BindingService(
      customerService as any,
      db as any,
      cache as any,
      pii as any,
      rateLimiter,
    );
    await expect(
      service.bindRegister('user-1', 'sess-1', PROFILE, null),
    ).rejects.toThrow(ValidationException);
  });

  // ── consistency: after create, resolve sees the new customer ───────────────
  it('after a successful create, resolve(phone) returns the new customer (consistency)', async () => {
    const customerService = new MockCustomerServiceClient();
    expect((await customerService.resolve('+84900000077')).status).toBe('none');
    await customerService.create('+84900000077', PROFILE);
    expect((await customerService.resolve('+84900000077')).status).toBe('one');
    // a second create for the same phone → Conflict (atomic phone-uniqueness)
    await expect(customerService.create('+84900000077', PROFILE)).rejects.toThrow(
      ConflictException,
    );
  });
});
