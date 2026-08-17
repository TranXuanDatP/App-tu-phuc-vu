/**
 * BindingVerifiedGuard
 *
 * Global NestJS guard (APP_GUARD). On customer-data routes (default-deny) it:
 *   1. resolves the user's VERIFIED binding (cache `bind:{userId}` FIRST, DB fallback),
 *   2. decrypts the customerId PER-REQUEST in memory (cache holds CIPHERTEXT only —
 *      never plaintext, so a Redis dump leaks no more than the encrypted DB column),
 *   3. attaches `request.customer = { id, customerId, customerRef, verifiedAt, deviceInfo }`,
 *   4. denies (403 BINDING_REQUIRED) when no verified binding exists.
 *
 * Authentication (OTP) ≠ binding (bill-secret proof): a freshly OTP'd user with no
 * verified binding is denied customer data (SPEC-safe-wire §0.2). The attached
 * `request.customer.customerId` is the BOUND customer — handlers read it via
 * @CustomerId(); it NEVER comes from the client (A2 IDOR fix, SPEC-A2 §D2).
 *
 * OPT-OUT enforcement: every authenticated route requires a binding unless marked
 * @SkipBindingVerified() (auth/onboarding/session/support) or @Public (no user → defer).
 * Forgetting a decorator on a NEW customer-data route is SAFE — it defaults to deny.
 */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Inject,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import { type DrizzleDB } from '@shared';
import { DATABASE_WRITE_TOKEN, CACHE_SERVICE_TOKEN } from '@core/constants/tokens';
import type { ICacheService } from '@core';
import { PII_ENCRYPTION_SERVICE_TOKEN } from '@modules/auth/constants/tokens';
import { PiiEncryptionService } from '@modules/auth/infrastructure/persistence/encryption/pii-encryption.service';
import { customerBindingsTable } from '../infrastructure/persistence/drizzle/schema/binding.schema';
import { SKIP_BINDING_VERIFIED_KEY } from '../decorators/skip-binding-verified.decorator';

/** The bound customer attached to request.customer by this guard. */
export interface BoundCustomer {
  id: string;
  /** DECRYPTED real Customer 360 id (lives only in request memory, never cached). */
  customerId: string;
  customerRef: string;
  verifiedAt: Date | null;
  deviceInfo: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    customer?: BoundCustomer;
  }
}

/** What's cached — customerId stays CIPHERTEXT (PiiEncryptionService decrypts per request). */
interface BindingCacheEntry {
  customerIdCipher: string | null;
  customerRef: string;
  verifiedAt: Date | null;
  deviceInfo: string | null;
}

@Injectable()
export class BindingVerifiedGuard implements CanActivate {
  private readonly logger = new Logger(BindingVerifiedGuard.name);
  private readonly CACHE_TTL_SEC = 60 * 60;

  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE_WRITE_TOKEN) private readonly db: DrizzleDB,
    @Inject(CACHE_SERVICE_TOKEN) private readonly cache: ICacheService,
    @Inject(PII_ENCRYPTION_SERVICE_TOKEN) private readonly pii: PiiEncryptionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: { id?: string };
      customer?: BoundCustomer;
    }>();
    const userId = request?.user?.id;
    if (!userId) {
      // No authenticated identity (e.g. @Public reached here) — defer to SessionAuthGuard
      // (it owns 401 for unauthenticated; @Public routes have no user so they pass).
      return true;
    }

    // OPT-OUT: deny every authenticated route by default; only skip where marked.
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_BINDING_VERIFIED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) return true; // @SkipBindingVerified — authenticated, not customer-data

    const entry = await this.resolveBinding(userId);
    if (!entry) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'BINDING_REQUIRED',
        message: 'Customer binding not verified.',
      });
    }

    // Decrypt per-request. Cache holds ciphertext; plaintext lives only in request memory.
    const customerId = this.pii.decryptIfNeeded(entry.customerIdCipher);
    if (!customerId) {
      // A verified binding must have a customerId. Missing/undecryptable = data integrity.
      this.logger.error(
        `binding verified but customerId missing/undecryptable for user ${this.pii.hashForLog(userId)}`,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          code: 'BINDING_INTEGRITY',
          message: 'Binding integrity error.',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    request.customer = {
      id: userId,
      customerId,
      customerRef: entry.customerRef,
      verifiedAt: entry.verifiedAt,
      deviceInfo: entry.deviceInfo,
    };
    return true;
  }

  /** Cache (ciphertext) first → DB fallback. null = no verified binding. */
  private async resolveBinding(userId: string): Promise<BindingCacheEntry | null> {
    const key = `bind:${userId}`;
    const cached = await this.cache.get<BindingCacheEntry | null>(key);
    if (cached) return cached;

    const rows = await this.db
      .select({
        customerIdCipher: customerBindingsTable.customerId,
        customerRef: customerBindingsTable.customerRef,
        verifiedAt: customerBindingsTable.verifiedAt,
        deviceInfo: customerBindingsTable.deviceInfo,
      })
      .from(customerBindingsTable)
      .where(
        and(
          eq(customerBindingsTable.userId, userId),
          eq(customerBindingsTable.status, 'verified'),
        ),
      )
      .limit(1);

    if (rows.length === 0) return null;

    const entry: BindingCacheEntry = {
      customerIdCipher: rows[0].customerIdCipher,
      customerRef: rows[0].customerRef,
      verifiedAt: rows[0].verifiedAt,
      deviceInfo: rows[0].deviceInfo,
    };
    // Cache CIPHERTEXT only (never the decrypted id).
    await this.cache.set(key, entry, this.CACHE_TTL_SEC).catch((err: unknown) => {
      this.logger.warn(`failed to warm binding cache for ${this.pii.hashForLog(userId)}: ${(err as Error).message}`);
    });
    return entry;
  }
}
