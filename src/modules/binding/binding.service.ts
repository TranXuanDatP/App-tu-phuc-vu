/**
 * BindingService — orchestrates the bind-init / bind challenge flow (A1.3).
 *
 * Security invariants (SPEC-A4-A1 §A1.3 + Rev-2 Fix 1):
 *  - bind-init NEVER takes phone from the client — it resolves the OTP-verified
 *    SESSION phone (server-internal). resolve/phone is not exposed to clients.
 *  - bind NEVER accepts a free-form customerRef — it rejects any ref that did not
 *    come back from THIS session's bind-init resolve (stored in cache, TTL 5 min).
 *    An attacker with session A therefore cannot bind a customerRef of session B.
 *  - the BFF does not know the secret — it forwards secretType/secretValue to
 *    customer-service and acts only on {verified}.
 *  - on verify=true, the real customerId is fetched via profile() and ENCRYPTED at
 *    rest into the binding row (PiiEncryptionService, Fix 5b).
 *
 * Lockout (A1.4) is delegated to BindingRateLimiter (dual ceiling).
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { type DrizzleDB } from '@shared';
import {
  DATABASE_WRITE_TOKEN,
  CACHE_SERVICE_TOKEN,
} from '@core/constants/tokens';
import type { ICacheService } from '@core';
import { ValidationException } from '@core/common';
import { ConflictException, LockoutException } from '@core/common';
import { PII_ENCRYPTION_SERVICE_TOKEN } from '@modules/auth/constants/tokens';
import { PiiEncryptionService } from '@modules/auth/infrastructure/persistence/encryption/pii-encryption.service';
import { usersTable } from '@modules/auth/infrastructure/persistence/drizzle/schema/user.schema';
import {
  CUSTOMER_SERVICE_CLIENT,
} from '@modules/account/clients/customer-service.client';
import type {
  CustomerServiceClient,
  CreateCustomerRequest,
  ResolveResult,
} from '@modules/account/clients/customer-service.client';
import { customerBindingsTable } from './infrastructure/persistence/drizzle/schema/binding.schema';
import {
  BindingAuditRepository,
  type BindingAuditEntry,
} from './infrastructure/persistence/binding-audit.repository';
import { BindingRateLimiter } from './binding-rate-limiter.service';
import type { BindBody, BindResult } from './dto/bind.dto';

@Injectable()
export class BindingService {
  private readonly logger = new Logger(BindingService.name);
  /** bind-init resolve results live 5 min — a bind must follow reasonably soon. */
  private readonly INIT_TTL_SEC = 5 * 60;
  /** Guard binding cache TTL — keep in sync with BindingVerifiedGuard.CACHE_TTL_SEC. */
  private readonly BINDING_CACHE_TTL_SEC = 60 * 60;

  constructor(
    @Inject(CUSTOMER_SERVICE_CLIENT) private readonly customerService: CustomerServiceClient,
    @Inject(DATABASE_WRITE_TOKEN) private readonly db: DrizzleDB,
    @Inject(CACHE_SERVICE_TOKEN) private readonly cache: ICacheService,
    @Inject(PII_ENCRYPTION_SERVICE_TOKEN) private readonly pii: PiiEncryptionService,
    private readonly rateLimiter: BindingRateLimiter,
    private readonly auditRepo: BindingAuditRepository,
  ) {}

  /**
   * A1.5 — mọi mutation binding → 1 row audit. Insert failure phải KHÔNG làm hỏng
   * bind UX (append-only forensic log: mất 1 row khi DB lỗi < chặn user bind xong).
   * Ordering: success-path gọi SAU upsertVerified → không bao giờ có audit row mồ côi.
   */
  private async writeAudit(entry: BindingAuditEntry): Promise<void> {
    try {
      await this.auditRepo.record(entry);
    } catch (err) {
      this.logger.warn(
        `binding_audit insert failed (${entry.action}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * POST /auth/bind-init — resolve the session phone server-side, stash the allowed
   * customerRefs for this session, return masked candidates for the user to pick.
   */
  async bindInit(
    userId: string,
    sessionId: string,
    deviceInfo: string | null,
    ip: string | null,
  ): Promise<ResolveResult> {
    const phone = await this.getSessionPhone(userId);
    if (!phone) {
      // No OTP-verified phone on the identity → nothing to resolve (no mutation
      // attempt → no audit row — A1.5 decision).
      return { status: 'none' };
    }

    const result = await this.customerService.resolve(phone);
    // A1.5 audit — bind-init is the highest-attack-value surface (N-match disambiguation).
    // Log the resolve outcome so the N-match rate is measurable and the keep-Fix-3 vs
    // deny-all decision can later be made on real numbers, not feel. user hash → PII
    // never in logs (hashForLog).
    this.logger.log(
      `bind-init resolve user=${this.pii.hashForLog(userId)} status=${result.status}` +
        (result.candidates ? ` N=${result.candidates.length}` : '') +
        (result.capped ? ' capped=true' : ''),
    );
    await this.writeAudit({
      userId,
      customerRef: result.status === 'one' ? result.customerRef : null,
      action: 'challenge_attempt',
      success: true,
      detail:
        `resolve:${result.status}` +
        (result.candidates ? ` N=${result.candidates.length}` : '') +
        (result.capped ? ' capped' : ''),
      ip,
      deviceInfo,
    });
    // Persist the resolve result keyed by sessionId so bind can validate customerRef
    // provenance (Fix 1). Single-use: deleted after a successful bind.
    await this.cache.set(this.initKey(sessionId), result, this.INIT_TTL_SEC);
    return result;
  }

  /**
   * POST /auth/bind — verify a bill-secret against a session-scoped customerRef.
   * Returns {bound:false} on wrong secret (until lockout → 429), {bound:true,...} on
   * success with the row written + customerId encrypted at rest.
   */
  async bind(
    userId: string,
    sessionId: string,
    body: BindBody,
    deviceInfo: string | null,
    ip: string | null,
  ): Promise<BindResult> {
    // Fix 1: customerRef must originate from THIS session's bind-init resolve.
    const init = await this.cache.get<ResolveResult | null>(this.initKey(sessionId));
    if (!init) {
      await this.writeAudit({
        userId,
        customerRef: body.customerRef,
        action: 'bind',
        success: false,
        detail: 'init_expired',
        ip,
        deviceInfo,
      });
      throw new ValidationException(
        'Phiên liên kết hết hạn hoặc chưa bắt đầu. Vui lòng thử lại.',
      );
    }
    if (!this.allowedRefs(init).includes(body.customerRef)) {
      this.logger.warn(
        `bind: customerRef not in session resolve — rejecting (user=${this.pii.hashForLog(userId)})`,
      );
      await this.writeAudit({
        userId,
        customerRef: body.customerRef,
        action: 'bind',
        success: false,
        detail: 'foreign_ref_rejected',
        ip,
        deviceInfo,
      });
      throw new ValidationException('Khách hàng không hợp lệ cho phiên này.');
    }

    // A1.4 — triple-ceiling lockout check BEFORE attempting verify. LockoutException
    // carries reason (user_ref|customer_ref|session) + retryAfterSec so the client can
    // show the right message + countdown; extends BaseException so the filter passes
    // code+details through (HttpException would strip them).
    const lock = await this.rateLimiter.checkLocked(userId, body.customerRef);
    if (lock.locked) {
      await this.writeAudit({
        userId,
        customerRef: body.customerRef,
        action: 'lockout',
        success: false,
        detail: `lockout_hit:${lock.reason ?? 'user_ref'}`,
        ip,
        deviceInfo,
      });
      throw new LockoutException(lock.reason ?? 'user_ref', lock.retryAfterSec ?? 900);
    }

    const verdict = await this.customerService.verify({
      customerRef: body.customerRef,
      secretType: body.secretType,
      secretValue: body.secretValue,
    });

    if (!verdict.verified) {
      const fail = await this.rateLimiter.recordFailure(userId, body.customerRef);
      // Một row / attempt: ceiling trip → row lockout; ngược lại verify_failed.
      await this.writeAudit({
        userId,
        customerRef: body.customerRef,
        action: fail.lockedNow ? 'lockout' : 'bind',
        success: false,
        detail: fail.lockedNow
          ? `lockout:${fail.reason ?? 'user_ref'} retrySec:${fail.retryAfterSec ?? 900}`
          : 'verify_failed',
        ip,
        deviceInfo,
      });
      if (fail.lockedNow) {
        throw new LockoutException(fail.reason ?? 'user_ref', fail.retryAfterSec ?? 900);
      }
      return { bound: false };
    }

    // Verified → fetch the real customerId, encrypt at rest, upsert the binding.
    const profile = await this.customerService.profile(body.customerRef);
    const encCustomerId = this.pii.encryptIfNeeded(profile.customerId);
    const now = new Date();
    await this.upsertVerified({
      userId,
      customerRef: body.customerRef,
      encCustomerId,
      factorUsed: body.secretType,
      deviceInfo,
      now,
    });
    await this.rateLimiter.clearFailures(userId, body.customerRef);
    await this.cache.delete(this.initKey(sessionId)); // single-use token
    await this.writeAudit({
      userId,
      customerRef: body.customerRef,
      action: 'bind',
      success: true,
      detail: `factor:${body.secretType}`,
      ip,
      deviceInfo,
    });

    // Warm the guard's binding cache so the next customer-data request is a cache HIT.
    // Store CIPHERTEXT only (A2 D3 / redline #1) — the guard decrypts per-request.
    await this.cache
      .set(
        this.bindKey(userId),
        {
          customerIdCipher: encCustomerId,
          customerRef: body.customerRef,
          verifiedAt: now,
          deviceInfo,
        },
        this.BINDING_CACHE_TTL_SEC,
      )
      .catch((err: unknown) => {
        this.logger.warn(
          `failed to warm binding cache: ${(err as Error).message}`,
        );
      });

    // customerId KHÔNG xuất hiện trong log (plaintext id — encryption-at-rest bị
    // log phá vỡ nếu in ra; dùng customerRef làm handle + hash user).
    this.logger.log(
      `binding verified: user=${this.pii.hashForLog(userId)} customerRef=${body.customerRef}`,
    );
    return { bound: true, customerId: profile.customerId };
  }

  /**
   * POST /auth/register — the NEW-CUSTOMER branch of the unified bind flow (resolve-gated).
   * Used when bind-init resolve returned 'none'. Two reject points (SPEC-binding §4):
   *   1. re-resolve (early, best-effort): if the phone now resolves to an existing customer
   *      → 409, reroute to the challenge branch.
   *   2. create (race tail, the real gate): customer-service enforces atomic phone-uniqueness;
   *      if the phone just appeared → Conflict → 409, reroute, NEVER auto-bind.
   * On success: create Customer 360 + insert a verified binding (creation = proof) + warm cache.
   */
  async bindRegister(
    userId: string,
    sessionId: string,
    profile: CreateCustomerRequest,
    deviceInfo: string | null,
    ip: string | null,
  ): Promise<BindResult> {
    const phone = await this.getSessionPhone(userId);
    if (!phone) {
      throw new ValidationException(
        'Không có số điện thoại đã xác thực trên phiên để đăng ký.',
      );
    }

    // Reject point 1 — re-resolve server-side (do NOT trust a stale bind-init 'none').
    const resolve = await this.customerService.resolve(phone);
    if (resolve.status !== 'none') {
      await this.writeAudit({
        userId,
        action: 'register',
        success: false,
        detail: `re_resolve:${resolve.status}`,
        ip,
        deviceInfo,
      });
      throw new ConflictException(
        'Khách hàng đã tồn tại cho số này — dùng luồng liên kết (bind), không đăng ký mới.',
        'CUSTOMER_EXISTS_USE_BIND',
        { status: resolve.status },
      );
    }

    // Reject point 2 — create with atomic phone-uniqueness (the race gate). Reroute on conflict.
    let created;
    try {
      created = await this.customerService.create(phone, profile);
    } catch (err) {
      if (err instanceof ConflictException) {
        this.logger.warn(
          `bindRegister: create conflict (race tail) for user ${this.pii.hashForLog(userId)} → reroute bind`,
        );
        await this.writeAudit({
          userId,
          action: 'register',
          success: false,
          detail: 'create_conflict',
          ip,
          deviceInfo,
        });
        throw new ConflictException(
          'Khách hàng vừa được tạo cho số này — dùng luồng liên kết (bind).',
          'CUSTOMER_EXISTS_USE_BIND',
        );
      }
      throw err;
    }

    // Success → insert verified binding (creation = proof) + warm cache.
    const encCustomerId = this.pii.encryptIfNeeded(created.customerId);
    const now = new Date();
    await this.upsertVerified({
      userId,
      customerRef: created.customerRef,
      encCustomerId,
      factorUsed: 'self_registration',
      deviceInfo,
      now,
    });
    await this.cache.delete(this.initKey(sessionId)); // consume any pending init token
    await this.writeAudit({
      userId,
      customerRef: created.customerRef,
      action: 'register',
      success: true,
      detail: 'factor:self_registration',
      ip,
      deviceInfo,
    });
    await this.cache
      .set(
        this.bindKey(userId),
        {
          customerIdCipher: encCustomerId,
          customerRef: created.customerRef,
          verifiedAt: now,
          deviceInfo,
        },
        this.BINDING_CACHE_TTL_SEC,
      )
      .catch((err: unknown) => {
        this.logger.warn(`failed to warm binding cache: ${(err as Error).message}`);
      });

    // customerId KHÔNG vào log (xem bind) — customerRef là handle + hash user.
    this.logger.log(
      `bindRegister: created+bound user=${this.pii.hashForLog(userId)} customerRef=${created.customerRef}`,
    );
    return { bound: true, customerId: created.customerId };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** The refs this session is allowed to bind — only what resolve returned. */
  private allowedRefs(init: ResolveResult): string[] {
    if (init.status === 'one') return init.customerRef ? [init.customerRef] : [];
    if (init.status === 'many') return (init.candidates ?? []).map((c) => c.customerRef);
    return [];
  }

  /** Read the OTP-verified phone off the identity row (server-side, never client). */
  private async getSessionPhone(userId: string): Promise<string | null> {
    const rows = await this.db
      .select({ phoneNumber: usersTable.phoneNumber })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    return rows[0]?.phoneNumber ?? null;
  }

  /** Insert a verified binding, or reactivate an existing (user, customerRef) row. */
  private async upsertVerified(args: {
    userId: string;
    customerRef: string;
    encCustomerId: string | null;
    factorUsed: string;
    deviceInfo: string | null;
    now: Date;
  }): Promise<void> {
    const { userId, customerRef, encCustomerId, factorUsed, deviceInfo, now } = args;
    const existing = await this.db
      .select({ id: customerBindingsTable.id })
      .from(customerBindingsTable)
      .where(
        and(
          eq(customerBindingsTable.userId, userId),
          eq(customerBindingsTable.customerRef, customerRef),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await this.db
        .update(customerBindingsTable)
        .set({
          customerId: encCustomerId,
          status: 'verified',
          factorUsed,
          verifiedAt: now,
          boundAt: now,
          deviceInfo,
          revokedAt: null,
          revokedReason: null,
          updatedAt: now,
        })
        .where(eq(customerBindingsTable.id, existing[0].id));
    } else {
      await this.db.insert(customerBindingsTable).values({
        id: randomUUID(),
        userId,
        customerRef,
        customerId: encCustomerId,
        status: 'verified',
        factorUsed,
        verifiedAt: now,
        boundAt: now,
        deviceInfo,
        updatedAt: now,
      });
    }
  }

  private initKey(sessionId: string): string {
    return `bind:init:${sessionId}`;
  }

  private bindKey(userId: string): string {
    return `bind:${userId}`;
  }
}
