/**
 * Binding DTOs (Zod + types) for bind-init / bind endpoints (A1.3).
 */
import { z } from 'zod';

/** Pluggable verify factor (SPEC-A4-A1 A1.3). Concrete factor locks when B5 answered. */
export const SecretTypeSchema = z.enum(['last_invoice_amount', 'ma_kh']);
export type SecretType = z.infer<typeof SecretTypeSchema>;

/**
 * POST /auth/bind body.
 * Fix 1: customerRef is NOT free-form — the service rejects any ref that didn't come
 * back from THIS session's bind-init resolve. secretType/secretValue are forwarded to
 * customer-service; the BFF does NOT know what the secret is.
 */
export const BindSchema = z.object({
  customerRef: z.string().min(1).max(128),
  secretType: SecretTypeSchema,
  secretValue: z.string().min(1).max(256),
});

export type BindBody = z.infer<typeof BindSchema>;

/** POST /auth/bind result. customerId is the REAL Customer 360 id (decrypted view),
 * returned only after a verified bind — it is the caller's own customer. */
export interface BindResult {
  bound: boolean;
  customerId?: string;
}
