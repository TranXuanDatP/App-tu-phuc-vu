import {
  pgTable,
  varchar,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Customer Bindings Table
 *
 * Records a verified BINDING between a better-auth user (identity) and a customer
 * record (customerRef → customerId). This is the second, separate step of identity
 * (SPEC-safe-wire §0.2): authentication (OTP) ≠ binding (bill-secret proof). A user
 * with no `status='verified'` row is DENIED customer-data ports (BindingVerifiedGuard).
 *
 * Columns:
 *  - userId:    better-auth user id (the authenticated identity).
 *  - customerRef: the OPAQUE resolve token from customer-service (NOT the real
 *      customerId — resolve returns no PII). Stored so a re-bind reuses the same ref.
 *  - customerId: the REAL Customer 360 id, ENCRYPTED at rest via PiiEncryptionService
 *      (Fix 5b — varchar(512) holds the iv:authTag:ct ciphertext). NULL until verify
 *      passes; populated from customer-service profile() post-verify.
 *  - status: pending | verified | revoked. Only `verified` opens customer data.
 *
 * Indexes:
 *  - partial UNIQUE (userId, customerRef) WHERE status='verified' — at most one active
 *    binding per (user, customer); pending/revoked rows don't block re-bind.
 *  - (customerRef) — lookup by resolve result / per-customerRef global lockout.
 *  - (userId) — session-scoping check in the guard (fast).
 */
export const customerBindingsTable = pgTable(
  'customer_bindings',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 256 }).notNull(),
    customerRef: varchar('customer_ref', { length: 128 }).notNull(),
    /** AES-256-GCM ciphertext (PiiEncryptionService). NULL until verify passes. */
    customerId: varchar('customer_id', { length: 512 }),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    factorUsed: varchar('factor_used', { length: 50 }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    deviceInfo: varchar('device_info', { length: 512 }),
    boundAt: timestamp('bound_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: varchar('revoked_reason', { length: 256 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_customer_bindings_customer_ref').on(t.customerRef),
    index('idx_customer_bindings_user_id').on(t.userId),
    // At most one VERIFIED binding per (user, customer). Pending/revoked don't block.
    uniqueIndex('idx_customer_bindings_verified_unique')
      .on(t.userId, t.customerRef)
      .where(sql`status = 'verified'`),
  ],
);

export type CustomerBindingRecord = typeof customerBindingsTable.$inferSelect;
export type NewCustomerBindingRecord = typeof customerBindingsTable.$inferInsert;
