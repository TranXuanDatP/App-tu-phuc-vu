import {
  pgTable,
  varchar,
  timestamp,
  boolean,
  pgEnum,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * User Role Enum
 */
export const userRoleEnum = pgEnum('user_role', ['customer', 'admin']);

/**
 * User Status Enum
 */
export const userStatusEnum = pgEnum('user_status', [
  'active',
  'suspended',
  'deleted',
]);

/**
 * User Profile Status Enum — new-user identity (MVP)
 * - incomplete: user created (OTP verified) but identity not yet resolved/collected
 * - complete: identity resolved (existing customer via event) OR manually entered
 * - no_match: identity lookup ran but no Customer 360 record found (must enter info)
 */
export const userProfileStatusEnum = pgEnum('user_profile_status', [
  'incomplete',
  'complete',
  'no_match',
]);

/**
 * Users Table Schema
 *
 * Stores customer identity records in the BFF-owned PostgreSQL database.
 *
 * PII fields (email, phone):
 * - Encrypted via AES-256-GCM with random IV (stored in email/phone columns)
 * - Searchable via HMAC-SHA256 blind index (stored in email_hash/phone_hash columns)
 * - Query pattern: WHERE phone_hash = hmac_sha256(phone_input, secret)
 */
export const usersTable = pgTable(
  'users',
  {
    id: varchar('id', { length: 256 }).primaryKey(),
    // PII fields — AES-256-GCM encrypted (random IV, NOT searchable directly)
    email: varchar('email', { length: 512 }),
    phone: varchar('phone', { length: 512 }),
    // Blind index hashes — HMAC-SHA256 for searchable lookups
    emailHash: varchar('email_hash', { length: 64 }),
    phoneHash: varchar('phone_hash', { length: 64 }),
    name: varchar('name', { length: 255 }),
    // ⚠️ PLAINTEXT BY PLUGIN DESIGN — see SECURITY note below.
    // better-auth's phoneNumber plugin requires an equality lookup
    // (`WHERE phone_number = <input>`), so it MUST store the raw phone to match.
    // Unlike `phone`/`email` (AES-256-GCM via databaseHooks), this column CANNOT
    // be encrypted without forking the plugin. PROTECTION IS AT THE STORAGE LAYER:
    // the Postgres volume MUST be encrypted at rest (LUKS / encrypted EBS / TDE)
    // in every environment — this is the compensating control for NFR-S1.
    phoneNumber: varchar('phone_number', { length: 512 }),
    phoneNumberVerified: boolean('phone_number_verified').default(false),
    // better-auth email verification
    emailVerified: boolean('email_verified').default(false),
    image: varchar('image', { length: 1024 }),
    role: userRoleEnum('role').default('customer'),
    status: userStatusEnum('status').default('active'),
    // Customer 360 link (mã KH) — set when matched to a customer record (event or manual)
    customerId: varchar('customer_id', { length: 128 }),
    // ── New-user identity (MVP) ───────────────────────────────────────────────
    // Collected via event (existing-customer match) or manual complete-profile screen.
    fullName: varchar('full_name', { length: 255 }),
    address: varchar('address', { length: 512 }),
    // CCCD — AES-256-GCM ciphertext (encrypted via databaseHooks like email/phone)
    cccd: varchar('cccd', { length: 512 }),
    // CCCD blind index — HMAC-SHA256 for dedup lookup (multiple NULLs allowed)
    cccdHash: varchar('cccd_hash', { length: 64 }),
    profileStatus: userProfileStatusEnum('profile_status').default('incomplete'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    // Unique blind index for phone lookup — prevents duplicate phone registrations
    uniqueIndex('idx_users_phone_hash').on(table.phoneHash),
    // Unique blind index for email lookup — prevents duplicate email registrations
    uniqueIndex('idx_users_email_hash').on(table.emailHash),
    // Unique blind index for CCCD lookup — prevents duplicate CCCD registrations
    uniqueIndex('idx_users_cccd_hash').on(table.cccdHash),
  ],
);

/**
 * TypeScript type for User record
 */
export type UserRecord = typeof usersTable.$inferSelect;
export type NewUserRecord = typeof usersTable.$inferInsert;
