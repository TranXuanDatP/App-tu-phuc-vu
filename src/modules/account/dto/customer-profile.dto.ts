/**
 * Customer Profile DTOs — Zod Schemas + TypeScript Types
 *
 * Normalized response shapes for the customer-profile port.
 * (Moved from modules/customer — BFF owns no business data, DTOs are port contracts.)
 */

import { z } from 'zod';

// ── Customer Profile ────────────────────────────────────────────────────────

export const CustomerProfileSchema = z.object({
  customerId: z.string(),
  fullName: z.string(),
  classification: z.enum(['sinh_hoat', 'san_xuat', 'hanh_chinh']),
  address: z.object({
    street: z.string(),
    ward: z.string(),
    district: z.string(),
    city: z.string(),
    fullAddress: z.string(),
  }),
  contactInfo: z.object({
    phone: z.string().nullable(),
    email: z.string().nullable(),
    contactAddress: z.string().nullable(),
  }),
  status: z.enum(['active', 'inactive', 'suspended']),
});

export type CustomerProfileResponse = z.infer<typeof CustomerProfileSchema>;

// ── Create Customer (mock-first) ────────────────────────────────────────────
/**
 * Input for the `create-customer` method — creates a Customer 360 record.
 * Mock-first: the mock adapter builds a customerId + fullAddress and stores the
 * record in-memory; swap to a live InternalAdapterBase (HTTP POST) when the real
 * Customer 360 service lands — the port method name is unchanged.
 */
export const CreateCustomerRequestSchema = z.object({
  fullName: z.string(),
  classification: z.enum(['sinh_hoat', 'san_xuat', 'hanh_chinh']),
  address: z.object({
    street: z.string(),
    ward: z.string(),
    district: z.string(),
    city: z.string(),
  }),
  contactInfo: z.object({
    phone: z.string().nullable(),
    email: z.string().nullable(),
    contactAddress: z.string().nullable(),
  }),
  status: z.enum(['active', 'inactive', 'suspended']),
});

export type CreateCustomerRequest = z.infer<typeof CreateCustomerRequestSchema>;

// ── Timeline Entry & Response ───────────────────────────────────────────────

export const TimelineEntrySchema = z.object({
  eventType: z.string(),
  timestamp: z.string(),
  summary: z.string(),
  channel: z.enum(['app', 'zalo', 'hotline', 'counter', 'web']).nullable(),
  referenceId: z.string().nullable(),
});

export const TimelineResponseSchema = z.object({
  entries: z.array(TimelineEntrySchema),
  totalCount: z.number(),
});

export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;
export type TimelineResponse = z.infer<typeof TimelineResponseSchema>;

// ── Related Accounts ────────────────────────────────────────────────────────

export const RelatedAccountSchema = z.object({
  customerId: z.string(),
  name: z.string(),
  relationshipType: z.string(), // e.g. 'parent_kcn', 'member_factory', 'auxiliary_contact'
  address: z.string().nullable(),
  contactInfo: z.record(z.string(), z.string().nullable()),
});

export const RelatedAccountsResponseSchema = z.object({
  accounts: z.array(RelatedAccountSchema),
});

export type RelatedAccount = z.infer<typeof RelatedAccountSchema>;
export type RelatedAccountsResponse = z.infer<typeof RelatedAccountsResponseSchema>;

// ── Update Profile Response ─────────────────────────────────────────────────

export const UpdateProfileResponseSchema = z.object({
  customerId: z.string(),
  updatedFields: z.array(z.string()),
  updatedAt: z.string(),
});

export type UpdateProfileResponse = z.infer<typeof UpdateProfileResponseSchema>;
