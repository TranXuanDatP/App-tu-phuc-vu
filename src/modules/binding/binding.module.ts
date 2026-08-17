/**
 * Binding Module
 *
 * Owns the customer-BINDING concern: the proof step that opens customer data
 * (separate from OTP authentication). Provides:
 *  - BindingVerifiedGuard — global APP_GUARD, OPT-OUT: every authenticated route requires
 *    a verified binding unless marked @SkipBindingVerified (auth/onboarding/session/support)
 *    or @Public. Forgetting a decorator on a new customer-data route is SAFE (default-deny).
 *  - BindingController — POST /auth/bind-init + /auth/bind + /auth/register (A1.3 + §4).
 *  - BindingService — session-scoped resolve + verify + encrypted customerId upsert.
 *  - BindingRateLimiter — dual-ceiling brute-force lockout (A1.4).
 *
 * Registered as a global guard so customer-data protection is structural — a new
 * customer-data route is protected by default (opt-out), not by remembering a decorator.
 * SessionAuthGuard runs first (attaches request.user); this guard defers (allows) when no
 * user is present, so ordering is safe either way.
 */
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '@modules/auth/auth.module';
import { AccountModule } from '@modules/account/account.module';
import { BindingVerifiedGuard } from './guards/binding-verified.guard';
import { BindingService } from './binding.service';
import { BindingController } from './binding.controller';
import { BindingRateLimiter } from './binding-rate-limiter.service';
import { BindingAuditRepository } from './infrastructure/persistence/binding-audit.repository';

@Module({
  imports: [
    // PII_ENCRYPTION_SERVICE_TOKEN (encrypt customerId at rest)
    AuthModule,
    // CUSTOMER_SERVICE_CLIENT (resolve/verify/profile — mock-first)
    AccountModule,
  ],
  controllers: [BindingController],
  providers: [
    BindingService,
    BindingAuditRepository,
    BindingRateLimiter,
    BindingVerifiedGuard,
    { provide: APP_GUARD, useExisting: BindingVerifiedGuard },
  ],
  exports: [BindingVerifiedGuard],
})
export class BindingModule {}
