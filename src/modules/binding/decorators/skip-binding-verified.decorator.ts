/**
 * @SkipBindingVerified() — mark an authenticated controller/route as NOT requiring a
 * verified customer binding. BindingVerifiedGuard (global APP_GUARD, OPT-OUT) denies
 * every authenticated route by default unless marked @SkipBindingVerified.
 *
 * Apply to routes that are authenticated but not customer-data: auth (me/register/bind/
 * check-registration/link-*), onboarding, session, support/chat. Do NOT apply to
 * customer-data controllers (billing/usage/payment/report/contract/notification/account) —
 * those stay default-deny (require a verified binding).
 *
 * @Public routes (better-auth /api/auth/*, webhooks, health) bypass via SessionAuthGuard
 * (no request.user) and don't need this decorator.
 */
import { SetMetadata } from '@nestjs/common';

export const SKIP_BINDING_VERIFIED_KEY = 'skip_binding_verified';
export const SkipBindingVerified = () =>
  SetMetadata(SKIP_BINDING_VERIFIED_KEY, true);
