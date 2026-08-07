/**
 * @CustomerId() param decorator — the BOUND customer id (A2 IDOR fix).
 *
 * Reads `request.customer.customerId`, set by BindingVerifiedGuard from the user's VERIFIED
 * binding (decrypted per-request, ciphertext-only in cache). On a customer-data route (default-deny)
 * the guard guarantees it. Use this instead of `@CurrentUser('id')`-as-customerId or any
 * client-supplied id — the bound customerId is the ONLY source of truth for which customer's
 * data a handler may touch.
 *
 * Reaching this decorator without `request.customer` = the route used @CustomerId() on a
 * non-customer route (misconfiguration — customer-data routes are default-deny and resolve
 * the binding) → throw loudly (fail fast, not silently fall back).
 */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { BoundCustomer } from '../guards/binding-verified.guard';

export const CustomerId = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  const customer = request?.customer as BoundCustomer | undefined;
  if (!customer?.customerId) {
    throw new Error(
      '@CustomerId() requires a binding-verified route (no bound customer resolved)',
    );
  }
  return customer.customerId;
});
