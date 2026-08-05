/**
 * Customer-Service Client — the secure wire for customer BINDING.
 *
 * This is DISTINCT from the customer-profile PORT (PortRegistry +
 * MockCustomerProfileAdapter): that port backs the lean Account/BFF read paths and
 * app registration, where resolve returns the full profile to auto-link. THIS client
 * implements the resolve/verify/profile contract (SPEC-safe-wire Phần C / SPEC-A4-A1
 * §A4) that the BINDING flow uses — where resolve deliberately returns ONLY a masked
 * candidate (no real customerId / PII) and verify never echoes the secret.
 *
 * Mock-first: the real customer-service resolve/verify/profile endpoints don't exist
 * yet (team customer-service must answer B5 — which secret verify supports). Until
 * then MockCustomerServiceClient is the implementation. Swap to an HTTP client when
 * the contract goes live — the interface stays unchanged (zero binding-flow churn).
 */
import type { CustomerProfileResponse } from '../dto/customer-profile.dto';

/**
 * resolve() result. A masked candidate ONLY — never the real customerId, full name,
 * phone, mã KH, contract # or amount. The hint is ADDRESS-based (Fix 3) so it can't
 * shrink the space of any factor that could itself be the verify secret.
 */
export interface ResolveResult {
  status: 'none' | 'one' | 'many';
  /** Internal opaque reference (NOT the real customerId). Present for one/many. */
  customerRef?: string;
  /** e.g. "Nguyễn V*** • 12 Lê Lợi, Hải Châu" — enough to recognize, not enumerate. */
  maskedHint?: string;
  /** Disambiguation list for N-match (entries differ by ADDRESS). Present for many. */
  candidates?: Array<{ customerRef: string; maskedHint: string }>;
}

/** Pluggable verify factor (SPEC-A4-A1 A1.3). Concrete factor locks when B5 is answered. */
export type SecretType = 'last_invoice_amount' | 'ma_kh';

export interface VerifyRequest {
  customerRef: string;
  secretType: SecretType;
  secretValue: string;
}

export interface VerifyResult {
  verified: boolean;
}

export interface CustomerServiceClient {
  /**
   * phone → { none | one | many }.
   * Fix 1 (server-scoped): phone is the OTP-verified session phone, NEVER free-form
   * client input. This method is called server-side by the binding flow only.
   */
  resolve(phone: string): Promise<ResolveResult>;

  /**
   * Verify a bill-secret server-side. Returns {verified:false} for both wrong-value
   * and unknown-customerRef with the SAME shape (no oracle) and never echoes the real
   * secret value.
   */
  verify(req: VerifyRequest): Promise<VerifyResult>;

  /**
   * Full Customer 360 profile. Callable ONLY after a verified binding — the BFF
   * enforces this; the client trusts the caller. Supplies the real customerId that
   * gets encrypted at rest into the binding row.
   */
  profile(customerRef: string): Promise<CustomerProfileResponse>;

  /**
   * Omnichannel future (SPEC Fix 4 / Phần C resolve/channel). Same authority as
   * resolve/phone. Mock stub: APP reuses phone resolve, other channels → 'none'.
   */
  resolveChannel(channel: string, channelId: string): Promise<ResolveResult>;
}

/** DI token for the customer-service client used by the binding flow. */
export const CUSTOMER_SERVICE_CLIENT = Symbol('CUSTOMER_SERVICE_CLIENT');
