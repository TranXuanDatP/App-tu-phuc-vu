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

  // ── POST /auth/register ──────────────────────────────────────────────────

  describe('register — contract shape', () => {
    it('should return {ok:true, profileStatus:"complete", customerId, linked:true} on success', async () => {
      mockDb = createMockDb({ phoneNumber: '+84901234567', profileStatus: 'incomplete' });
      mockPortRegistry.execute.mockResolvedValue({ data: MOCK_CUSTOMER });

      controller = new AuthController({} as any, mockPortRegistry as any, mockDb as any, { get: () => undefined } as any);

      const result = await controller.register('user-1', VALID_REGISTER_BODY);

      expect(result).toEqual({
        ok: true,
        profileStatus: 'complete',
        customerId: 'APP-000001',
        linked: true,
      });
    });

    it('should throw ValidationException when user is already complete (dedup by phone)', async () => {
      mockDb = createMockDb({ phoneNumber: '+84901234567', profileStatus: 'complete' });

      controller = new AuthController({} as any, mockPortRegistry as any, mockDb as any, { get: () => undefined } as any);

      await expect(controller.register('user-1', VALID_REGISTER_BODY)).rejects.toThrow(
        ValidationException,
      );
    });

    it('should throw ValidationException on invalid body (missing required fields)', async () => {
      mockDb = createMockDb(null);
      controller = new AuthController({} as any, mockPortRegistry as any, mockDb as any, { get: () => undefined } as any);

      await expect(controller.register('user-1', { fullName: 'X' })).rejects.toThrow(
        ValidationException,
      );
    });
  });

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

    it('should return {registered:false} when user has no phone', async () => {
      mockDb = createMockDb(null);

      controller = new AuthController({} as any, mockPortRegistry as any, mockDb as any, { get: () => undefined } as any);

      const result = await controller.checkRegistration('user-1');

      expect(result.registered).toBe(false);
    });
  });
});
