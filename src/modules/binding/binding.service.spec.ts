/**
 * BindingService — A1.5 audit matrix + PII log remediation tests.
 *
 * Khóa 3 lớp:
 *  1. AUDIT MATRIX — mỗi mutation attempt đúng 1 row binding_audit với
 *     {action, success, detail} đúng (challenge_attempt / bind / lockout /
 *     register), gồm cả path từng im lặng (verify fail) và reject points.
 *  2. UX PROTECTION — audit insert fail KHÔNG làm hỏng bind (warn + vẫn bound).
 *  3. PII — log lines chứa hash 8-char + customerRef, KHÔNG chứa raw
 *     userId/customerId (encryption-at-rest bị log phá vỡ nếu in plaintext).
 *
 * House style: hand-mock deps, `new BindingService({...} as any)` (không Nest
 * Test module, không PG thật).
 */
import { ValidationException, ConflictException } from '@core/common';
import { LockoutException } from '@core/common';
import { BindingService } from './binding.service';

const USER = 'usr-raw-secret-id-001';
const USER_HASH = 'a1b2c3d4';
const REF = 'REF-001';
const CID = 'QN-0912345';
const ENC_CID = `enc:${CID}`;
const IP = '203.0.113.9';
const DEVICE = 'device-xyz';

const BIND_BODY = {
  customerRef: REF,
  secretType: 'last_invoice_amount' as const,
  secretValue: '247500',
};

/** Drizzle chain mock — mỗi select() pops kết quả kế tiếp từ queue. */
function createDb(selectResults: Array<unknown[]>) {
  const queue = [...selectResults];
  const limit = jest.fn(() => Promise.resolve(queue.shift() ?? []));
  const where = jest.fn(() => ({ limit }));
  const from = jest.fn(() => ({ where }));
  return {
    select: jest.fn(() => ({ from })),
    insert: jest.fn(() => ({ values: jest.fn().mockResolvedValue(undefined) })),
    update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) })) })),
  };
}

function createService(overrides: Record<string, unknown> = {}) {
  const db = (overrides.db as any) ?? createDb([
    [{ phoneNumber: '+84987654321' }], // getSessionPhone
    [], // upsertVerified: no existing binding → insert
  ]);
  const customerService = (overrides.customerService as any) ?? {
    resolve: jest.fn(),
    verify: jest.fn(),
    profile: jest.fn().mockResolvedValue({ customerId: CID }),
    create: jest.fn(),
  };
  const cache = (overrides.cache as any) ?? {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const pii = (overrides.pii as any) ?? {
    encryptIfNeeded: jest.fn((v: string | null) => (v ? ENC_CID : null)),
    hashForLog: jest.fn(() => USER_HASH),
  };
  const rateLimiter = (overrides.rateLimiter as any) ?? {
    checkLocked: jest.fn().mockResolvedValue({ locked: false }),
    recordFailure: jest.fn().mockResolvedValue({ lockedNow: false }),
    clearFailures: jest.fn().mockResolvedValue(undefined),
  };
  const auditRepo = (overrides.auditRepo as any) ?? { record: jest.fn().mockResolvedValue(undefined) };

  const service = new BindingService(
    customerService,
    db,
    cache,
    pii,
    rateLimiter,
    auditRepo,
  );
  return { service, db, customerService, cache, pii, rateLimiter, auditRepo };
}

/** Cache mock có sẵn init resolve 'one' cho bind flow. */
function initWithOneRef(cache: any) {
  cache.get.mockImplementation(async (key: string) => {
    if (key.startsWith('bind:init:')) {
      return { status: 'one', customerRef: REF };
    }
    return null;
  });
}

describe('BindingService — A1.5 audit', () => {
  describe('bindInit', () => {
    it('resolve xong → 1 row challenge_attempt với detail resolve:<status> N=<n> + ip/device', async () => {
      const { service, customerService, auditRepo } = createService({
        customerService: {
          resolve: jest.fn().mockResolvedValue({
            status: 'many',
            candidates: [
              { customerRef: 'REF-001', maskedHint: 'A', challenge: {} },
              { customerRef: 'REF-002', maskedHint: 'B', challenge: {} },
            ],
          }),
        },
      });

      await service.bindInit(USER, 'sess-1', DEVICE, IP);

      expect(auditRepo.record).toHaveBeenCalledTimes(1);
      expect(auditRepo.record).toHaveBeenCalledWith({
        userId: USER, // RAW trong DB (joinable forensics) — đúng quyết định A1.5
        customerRef: null,
        action: 'challenge_attempt',
        success: true,
        detail: 'resolve:many N=2',
        ip: IP,
        deviceInfo: DEVICE,
      });
    });

    it('no-phone → KHÔNG có audit row (không có mutation attempt)', async () => {
      const { service, auditRepo } = createService({ db: createDb([[]]) });
      await service.bindInit(USER, 'sess-1', null, null);
      expect(auditRepo.record).not.toHaveBeenCalled();
    });
  });

  describe('bind', () => {
    it('init hết hạn → 1 row bind/init_expired RỒI mới throw ValidationException', async () => {
      const { service, auditRepo } = createService({ cache: { get: jest.fn().mockResolvedValue(null), set: jest.fn(), delete: jest.fn() } });

      await expect(
        service.bind(USER, 'sess-1', BIND_BODY, DEVICE, IP),
      ).rejects.toThrow(ValidationException);
      expect(auditRepo.record).toHaveBeenCalledWith({
        userId: USER,
        customerRef: REF,
        action: 'bind',
        success: false,
        detail: 'init_expired',
        ip: IP,
        deviceInfo: DEVICE,
      });
    });

    it('foreign customerRef → 1 row bind/foreign_ref_rejected rồi throw (thứ tự: audit trước)', async () => {
      const cache = { get: jest.fn().mockResolvedValue({ status: 'one', customerRef: 'REF-OTHER' }), set: jest.fn(), delete: jest.fn() };
      const { service, auditRepo } = createService({ cache });

      await expect(
        service.bind(USER, 'sess-1', BIND_BODY, DEVICE, IP),
      ).rejects.toThrow(ValidationException);
      expect(auditRepo.record).toHaveBeenCalledTimes(1);
      expect(auditRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'bind', success: false, detail: 'foreign_ref_rejected' }),
      );
    });

    it('locked at entry → 1 row lockout/lockout_hit:<reason> rồi throw LockoutException', async () => {
      const cache = { get: jest.fn().mockResolvedValue({ status: 'one', customerRef: REF }), set: jest.fn(), delete: jest.fn() };
      const { service, auditRepo } = createService({
        cache,
        rateLimiter: {
          checkLocked: jest.fn().mockResolvedValue({ locked: true, reason: 'customer_ref', retryAfterSec: 86400 }),
          recordFailure: jest.fn(),
          clearFailures: jest.fn(),
        },
      });

      await expect(
        service.bind(USER, 'sess-1', BIND_BODY, DEVICE, IP),
      ).rejects.toThrow(LockoutException);
      expect(auditRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'lockout', success: false, detail: 'lockout_hit:customer_ref' }),
      );
    });

    it('sai secret (chưa ceiling) → 1 row bind/verify_failed + trả {bound:false} — path từng IM LẶNG', async () => {
      const cache = { get: jest.fn().mockResolvedValue({ status: 'one', customerRef: REF }), set: jest.fn(), delete: jest.fn() };
      const { service, auditRepo } = createService({
        cache,
        customerService: {
          resolve: jest.fn(),
          verify: jest.fn().mockResolvedValue({ verified: false }),
          profile: jest.fn(),
          create: jest.fn(),
        },
      });

      const r = await service.bind(USER, 'sess-1', BIND_BODY, DEVICE, IP);

      expect(r).toEqual({ bound: false });
      expect(auditRepo.record).toHaveBeenCalledTimes(1);
      expect(auditRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'bind', success: false, detail: 'verify_failed', ip: IP, deviceInfo: DEVICE }),
      );
    });

    it('sai secret + ceiling trip → 1 row lockout/lockout:<reason> retrySec rồi throw LockoutException', async () => {
      const cache = { get: jest.fn().mockResolvedValue({ status: 'one', customerRef: REF }), set: jest.fn(), delete: jest.fn() };
      const { service, auditRepo } = createService({
        cache,
        customerService: {
          resolve: jest.fn(),
          verify: jest.fn().mockResolvedValue({ verified: false }),
          profile: jest.fn(),
          create: jest.fn(),
        },
        rateLimiter: {
          checkLocked: jest.fn().mockResolvedValue({ locked: false }),
          recordFailure: jest.fn().mockResolvedValue({ lockedNow: true, reason: 'user_ref', retryAfterSec: 900 }),
          clearFailures: jest.fn(),
        },
      });

      await expect(service.bind(USER, 'sess-1', BIND_BODY, DEVICE, IP)).rejects.toThrow(LockoutException);
      expect(auditRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'lockout', detail: 'lockout:user_ref retrySec:900' }),
      );
    });

    it('verify thành công → đúng 1 row bind/success factor:<type>, viết SAU upsert; response shape không đổi', async () => {
      const cache = { get: jest.fn(), set: jest.fn().mockResolvedValue(undefined), delete: jest.fn().mockResolvedValue(undefined) };
      initWithOneRef(cache);
      const db = createDb([
        [], // upsert existing lookup — bind() không gọi getSessionPhone
      ]);
      const { service, auditRepo, db: _db } = createService({
        cache,
        db,
        customerService: {
          resolve: jest.fn(),
          verify: jest.fn().mockResolvedValue({ verified: true }),
          profile: jest.fn().mockResolvedValue({ customerId: CID }),
          create: jest.fn(),
        },
      });
      const insertSpy = db.insert as jest.Mock;

      const r = await service.bind(USER, 'sess-1', BIND_BODY, DEVICE, IP);

      expect(r).toEqual({ bound: true, customerId: CID });
      expect(auditRepo.record).toHaveBeenCalledTimes(1);
      expect(auditRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'bind', success: true, detail: 'factor:last_invoice_amount' }),
      );
      // Ordering: binding insert xảy ra TRƯỚC audit record (không có audit row mồ côi)
      expect(insertSpy.mock.invocationCallOrder[0]).toBeLessThan(
        (auditRepo.record as jest.Mock).mock.invocationCallOrder[0],
      );
      void _db;
    });

    it('UX PROTECTION: audit insert fail → bind VẪN {bound:true} + logger.warn (không phá UX)', async () => {
      const cache = { get: jest.fn(), set: jest.fn().mockResolvedValue(undefined), delete: jest.fn().mockResolvedValue(undefined) };
      initWithOneRef(cache);
      const { service, auditRepo } = createService({
        cache,
        customerService: {
          resolve: jest.fn(),
          verify: jest.fn().mockResolvedValue({ verified: true }),
          profile: jest.fn().mockResolvedValue({ customerId: CID }),
          create: jest.fn(),
        },
      });
      (auditRepo.record as jest.Mock).mockRejectedValueOnce(new Error('db down'));
      const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

      const r = await service.bind(USER, 'sess-1', BIND_BODY, DEVICE, IP);

      expect(r).toEqual({ bound: true, customerId: CID });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('binding_audit insert failed (bind)'));
      warnSpy.mockRestore();
    });
  });

  describe('bindRegister', () => {
    it('re-resolve thấy customer → 1 row register/re_resolve:<status> rồi throw ConflictException', async () => {
      const { service, auditRepo } = createService({
        customerService: {
          resolve: jest.fn().mockResolvedValue({ status: 'one', customerRef: REF }),
          verify: jest.fn(),
          profile: jest.fn(),
          create: jest.fn(),
        },
      });

      await expect(
        service.bindRegister(USER, 'sess-1', {} as any, DEVICE, IP),
      ).rejects.toThrow(ConflictException);
      expect(auditRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'register', success: false, detail: 're_resolve:one' }),
      );
    });

    it('create conflict (race tail) → 1 row register/create_conflict rồi throw', async () => {
      const { service, auditRepo } = createService({
        customerService: {
          resolve: jest.fn().mockResolvedValue({ status: 'none' }),
          verify: jest.fn(),
          profile: jest.fn(),
          create: jest.fn().mockRejectedValue(new ConflictException('dup', 'CUSTOMER_EXISTS_USE_BIND')),
        },
      });

      await expect(
        service.bindRegister(USER, 'sess-1', {} as any, DEVICE, IP),
      ).rejects.toThrow(ConflictException);
      expect(auditRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'register', success: false, detail: 'create_conflict' }),
      );
    });

    it('thành công → 1 row register/success factor:self_registration + customerRef', async () => {
      const db = createDb([
        [{ phoneNumber: '+84912345678' }],
        [],
      ]);
      const { service, auditRepo } = createService({
        db,
        customerService: {
          resolve: jest.fn().mockResolvedValue({ status: 'none' }),
          verify: jest.fn(),
          profile: jest.fn(),
          create: jest.fn().mockResolvedValue({ customerId: 'QN-NEW-1', customerRef: 'REF-NEW-9' }),
        },
      });

      const r = await service.bindRegister(USER, 'sess-1', {} as any, DEVICE, IP);

      expect(r).toEqual({ bound: true, customerId: 'QN-NEW-1' });
      expect(auditRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'register',
          success: true,
          detail: 'factor:self_registration',
          customerRef: 'REF-NEW-9',
        }),
      );
    });
  });
});

describe('BindingService — PII log remediation', () => {
  it('log success KHÔNG chứa raw userId / raw customerId — chứa hash 8-char + customerRef', async () => {
    const cache = { get: jest.fn(), set: jest.fn().mockResolvedValue(undefined), delete: jest.fn().mockResolvedValue(undefined) };
    initWithOneRef(cache);
    const { service, pii } = createService({
      cache,
      customerService: {
        resolve: jest.fn(),
        verify: jest.fn().mockResolvedValue({ verified: true }),
        profile: jest.fn().mockResolvedValue({ customerId: CID }),
        create: jest.fn(),
      },
    });
    const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);

    await service.bind(USER, 'sess-1', BIND_BODY, DEVICE, IP);

    const msg = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(msg).not.toContain(USER);        // raw userId vắng
    expect(msg).not.toContain(CID);         // raw customerId vắng (encryption-at-rest)
    expect(msg).toContain(USER_HASH);       // hash 8-char có mặt
    expect(msg).toContain(REF);             // customerRef (opaque handle) có mặt
    expect(pii.hashForLog).toHaveBeenCalledWith(USER);
    logSpy.mockRestore();
  });
});
