/**
 * BindingVerifiedGuard
 *
 * Global NestJS guard (APP_GUARD) that DENIES customer-data routes unless the
 * authenticated user has a verified customer binding (`customer_bindings.status =
 * 'verified'`). Authentication (OTP) ≠ binding (bill-secret proof): a freshly OTP'd
 * user with no verified binding is denied customer data (SPEC-safe-wire §0.2).
 *
 * Opt-in enforcement: only routes/controllers marked with @RequiresBinding() are
 * checked. This is the safe default to land (unmarked routes are unchanged); a future
 * hardening pass can flip to deny-by-default with @SkipBindingVerified() exemptions
 * once every route is catalogued.
 *
 * Runs after SessionAuthGuard (which attaches request.user). Order-agnostic: if no
 * user is present yet we DEFER (return true) and let SessionAuthGuard own the 401.
 */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Inject,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import { type DrizzleDB } from '@shared';
import { DATABASE_WRITE_TOKEN } from '@core/constants/tokens';
import { customerBindingsTable } from '../infrastructure/persistence/drizzle/schema/binding.schema';
import { REQUIRES_BINDING_KEY } from '../decorators/requires-binding.decorator';

@Injectable()
export class BindingVerifiedGuard implements CanActivate {
  private readonly logger = new Logger(BindingVerifiedGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE_WRITE_TOKEN) private readonly db: DrizzleDB,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiresBinding = this.reflector.getAllAndOverride<boolean>(
      REQUIRES_BINDING_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiresBinding) return true; // opt-in: only enforce where declared

    const request = context.switchToHttp().getRequest<{
      user?: { id?: string };
    }>();
    const userId = request?.user?.id;
    if (!userId) {
      // No authenticated identity yet — defer to SessionAuthGuard (it will 401).
      return true;
    }

    const verified = await this.db
      .select({ id: customerBindingsTable.id })
      .from(customerBindingsTable)
      .where(
        and(
          eq(customerBindingsTable.userId, userId),
          eq(customerBindingsTable.status, 'verified'),
        ),
      )
      .limit(1);

    if (verified.length === 0) {
      // deny-first: no verified binding → 403. (pending/revoked rows don't count.)
      throw new ForbiddenException({
        statusCode: 403,
        code: 'BINDING_REQUIRED',
        message: 'Customer binding not verified.',
      });
    }
    return true;
  }
}
