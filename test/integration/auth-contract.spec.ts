/**
 * Auth Contract Tests — lock the response shape the mobile app consumes.
 *
 * These tests chốt the CONTRACT before mock→live swap: each assertion defines
 * exactly what the mobile expects. A live adapter that breaks the shape will
 * fail here, not in the mobile.
 *
 * Pattern: direct controller instantiation (matches test/integration/payment.spec.ts).
 * Mock db (drizzle chain) + mock portRegistry → call controller method → assert shape.
 */

import { AuthController } from '../../src/modules/auth/infrastructure/http/auth.controller';
import { ValidationException } from '../../src/libs/core/common/exceptions/validation.exception';

// ── Mock helpers ────────────────────────────────────────────────────────────

/** Build a chainable drizzle mock: select().from().where().limit() + update().set().where() */
function createMockDb(userRow: object | null) {
  const limit = jest.fn().mockResolvedValue(userRow ? [userRow] : []);
  const whereSelect = jest.fn().mockReturnValue({ limit });
  const from = jest.fn().mockReturnValue({ where: whereSelect });
  const select = jest.fn().mockReturnValue({ from });

  const whereUpdate = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn().mockReturnValue({ where: whereUpdate });
  const update = jest.fn().mockReturnValue({ set });

  return { select, update };
}

/**
 * Mock db for GET /auth/me — getMe issues TWO selects (user row, then binding row).
 * limit() chains mockResolvedValueOnce in call order: 1st=user, 2nd=binding.
 */
function createMockDbForMe(userRow: object | null, bindingRow: object | null) {
  const limit = jest.fn()
    .mockResolvedValueOnce(userRow ? [userRow] : [])
    .mockResolvedValueOnce(bindingRow ? [bindingRow] : []);
  const whereSelect = jest.fn().mockReturnValue({ limit });
  const from = jest.fn().mockReturnValue({ where: whereSelect });
  const select = jest.fn().mockReturnValue({ from });
  return { select };
}

const VALID_REGISTER_BODY = {
  fullName: 'Test User',
  classification: 'sinh_hoat' as const,
  address: { street: '1 Lê Lợi', ward: 'An Hải', district: 'Sơn Trà', city: 'Đà Nẵng' },
};

const MOCK_CUSTOMER = {
  customerId: 'APP-000001',
  fullName: 'Test User',
  classification: 'sinh_hoat',
  address: { street: '1', ward: '2', district: '3', city: '4', fullAddress: '1, 2, 3, 4' },
  contactInfo: { phone: '+84901234567', email: null, contactAddress: null },
  status: 'active',
};

describe('Auth Contract Tests', () => {
  let controller: AuthController;
  let mockPortRegistry: { execute: jest.Mock };
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockPortRegistry = { execute: jest.fn() };
  });

  // NOTE: POST /auth/register moved to BindingController (register = new-customer branch
  // of the unified bind flow, resolve-gated — SPEC-binding §4). Its contract is now tested
  // in test/integration/binding-register.spec.ts (bindRegister: two reject points + create+bind).
  // AuthController no longer has a register() method.

  // ── POST /auth/check-registration ───────────────────────────────────────

  describe('check-registration — contract shape', () => {
    it('should return {registered:true, profileStatus:"complete", customerId} when phone matches', async () => {
      mockDb = createMockDb({ phoneNumber: '+84901234567' });
      mockPortRegistry.execute.mockResolvedValue({
        data: { ...MOCK_CUSTOMER, customerId: 'QN-0912345' },
      });

      controller = new AuthController({} as any, mockPortRegistry as any, mockDb as any, { get: () => undefined } as any);

      const result = await controller.checkRegistration('user-1');

      expect(result).toEqual({
        registered: true,
        profileStatus: 'complete',
        customerId: 'QN-0912345',
      });
    });

    it('should return {registered:false, profileStatus:"incomplete"} when no match', async () => {
      mockDb = createMockDb({ phoneNumber: '+84900000000' });
      mockPortRegistry.execute.mockResolvedValue({ data: null });

      controller = new AuthController({} as any, mockPortRegistry as any, mockDb as any, { get: () => undefined } as any);

      const result = await controller.checkRegistration('user-1');

      expect(result).toEqual({
        registered: false,
        profileStatus: 'incomplete',
      });
    });

    // W0: N-match must DENY — pick-first is a data-leak risk
    it('should return {registered:false} when CUSTOMER_SERVICE_URL set and phone matches N customers', async () => {
      // CUSTOMER_SERVICE_URL set → uses resolveFromCustomerService (fetch), not mock
      controller = new AuthController({} as any, mockPortRegistry as any, createMockDb({ phoneNumber: '+84900000000' }) as any, { get: (k: string) => k === 'CUSTOMER_SERVICE_URL' ? 'http://mock-cs' : undefined } as any);

      // Mock global fetch to return array of 2 customers
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [MOCK_CUSTOMER, { ...MOCK_CUSTOMER, customerId: 'CUST-2' }] }),
      }) as any;

      const result = await controller.checkRegistration('user-1');

      global.fetch = originalFetch;
      expect(result.registered).toBe(false);
    });

    // W0: response must NOT leak PII — only registered/profileStatus/customerId
    it('should not leak PII in check-registration response (only registered + profileStatus + customerId)', async () => {
      mockDb = createMockDb({ phoneNumber: '+84901234567' });
      mockPortRegistry.execute.mockResolvedValue({
        data: { ...MOCK_CUSTOMER, customerId: 'QN-0912345' },
      });

      controller = new AuthController({} as any, mockPortRegistry as any, mockDb as any, { get: () => undefined } as any);

      const result = await controller.checkRegistration('user-1') as Record<string, unknown>;

      // Must NOT contain any customer profile fields beyond customerId
      expect(Object.keys(result).sort()).toEqual(['customerId', 'profileStatus', 'registered']);
      expect(result).not.toHaveProperty('fullName');
      expect(result).not.toHaveProperty('address');
      expect(result).not.toHaveProperty('contactInfo');
      expect(result).not.toHaveProperty('classification');
    });

    it('should return {registered:false} when user has no phone', async () => {
      mockDb = createMockDb(null);

      controller = new AuthController({} as any, mockPortRegistry as any, mockDb as any, { get: () => undefined } as any);

      const result = await controller.checkRegistration('user-1');

      expect(result.registered).toBe(false);
    });
  });

  // ── GET /auth/me ────────────────────────────────────────────────────────────

  describe('getMe — linked source = customer_bindings (not users.customerId)', () => {
    it('linked=false when user has legacy users.customerId but NO verified binding (repoint proof)', async () => {
      // users.customerId set (via legacy check-registration phone-match) but no binding row →
      // guard would 403 this user. Old code returned linked=!!customerId=true (WRONG).
      mockDb = createMockDbForMe(
        { id: 'u1', fullName: 'A', cccd: null, customerId: 'QN-0912345', profileStatus: 'complete' },
        null,
      ) as any;
      controller = new AuthController({} as any, mockPortRegistry as any, mockDb as any, { get: () => undefined } as any);

      const result = await controller.getMe('u1');

      expect(result.linked).toBe(false); // NOT !!customerId — the whole point of the repoint
      expect(result.customerId).toBe('QN-0912345'); // legacy field kept (backward compat)
      expect(result.profileStatus).toBe('complete');
    });

    it('linked=true when a verified binding exists (even if users.customerId is null)', async () => {
      // bind-register path inserts a verified binding but never sets users.customerId.
      mockDb = createMockDbForMe(
        { id: 'u1', fullName: 'A', cccd: null, customerId: null, profileStatus: 'incomplete' },
        { id: 'b1' },
      ) as any;
      controller = new AuthController({} as any, mockPortRegistry as any, mockDb as any, { get: () => undefined } as any);

      const result = await controller.getMe('u1');

      expect(result.linked).toBe(true);
    });

    it('linked=false when no user found', async () => {
      mockDb = createMockDbForMe(null, null) as any;
      controller = new AuthController({} as any, mockPortRegistry as any, mockDb as any, { get: () => undefined } as any);

      const result = await controller.getMe('ghost');

      expect(result.linked).toBe(false);
      expect(result.profileStatus).toBe('incomplete');
    });
  });
});
