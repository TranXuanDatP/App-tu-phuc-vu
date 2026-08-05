/**
 * @RequiresBinding() — mark a controller/route as requiring a VERIFIED customer
 * binding. BindingVerifiedGuard (global APP_GUARD) enforces it: no
 * `customer_bindings` row with status='verified' for the authenticated user → 403.
 *
 * Opt-in: unmarked routes are NOT binding-checked. Apply this to every customer-data
 * controller (billing, usage, payment, report/incidents, contracts, notifications,
 * account/customers). Do NOT apply to auth, support/chat, onboarding, or webhooks.
 */
import { SetMetadata } from '@nestjs/common';

export const REQUIRES_BINDING_KEY = 'requires_binding_verified';
export const RequiresBinding = () => SetMetadata(REQUIRES_BINDING_KEY, true);
