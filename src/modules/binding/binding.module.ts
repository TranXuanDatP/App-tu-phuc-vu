/**
 * Binding Module
 *
 * Owns the customer-BINDING concern: the proof step that opens customer data
 * (separate from OTP authentication). Provides:
 *  - BindingVerifiedGuard — global APP_GUARD; denies @RequiresBinding() routes
 *    unless the user has a verified binding.
 *  - BindingController — POST /auth/bind-init + /auth/bind (A1.3).
 *  - BindingService — session-scoped resolve + verify + encrypted customerId upsert.
 *  - BindingRateLimiter — dual-ceiling brute-force lockout (A1.4).
 *
 * Registered as a global guard so customer-data protection is structural (you can't
 * forget it per-controller); the opt-in @RequiresBinding() marker scopes which routes
 * enforce. SessionAuthGuard runs first (attaches request.user); this guard defers
 * (allows) when no user is present, so ordering is safe either way.
 */
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '@modules/auth/auth.module';
import { AccountModule } from '@modules/account/account.module';
import { BindingVerifiedGuard } from './guards/binding-verified.guard';
import { BindingService } from './binding.service';
import { BindingController } from './binding.controller';
import { BindingRateLimiter } from './binding-rate-limiter.service';

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
    BindingRateLimiter,
    BindingVerifiedGuard,
    { provide: APP_GUARD, useExisting: BindingVerifiedGuard },
  ],
  exports: [BindingVerifiedGuard],
})
export class BindingModule {}
