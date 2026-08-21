import { pgTable, varchar, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * Mock Customer Store — hậu cứ durable cho MockCustomerProfileAdapter.
 *
 * Trước đây khách tạo qua create-customer nằm trong Map in-memory → BFF restart
 * là mất → get-profile rơi về fixture chung = user đăng ký thấy hồ sơ của
 * người khác (bug Pc bắt 2026-08-21: "tài khoản mới vẫn ra dữ liệu mock").
 * Bảng này giữ khách do mock tạo sống qua restart;CustomerId tiếp tục đánh số
 * từ max hiện có (không reset APP-000001 gây trùng).
 */
export const mockCustomerStoreTable = pgTable(
  'mock_customer_store',
  {
    /** APP-NNNNNN — sinh từ max hiện có + 1. */
    customerId: varchar('customer_id', { length: 32 }).primaryKey(),
    /** Số phone đã normalize (digits, bỏ 84/0 đầu) — null nếu khách không có phone. */
    phone: varchar('phone', { length: 20 }),
    fullName: text('full_name').notNull(),
    classification: varchar('classification', { length: 20 }).notNull(),
    /** Structured address (street/ward/district/city/fullAddress) — jsonb. */
    address: jsonb('address').$type<Record<string, unknown>>().notNull(),
    contactInfo: jsonb('contact_info').$type<Record<string, unknown> | null>(),
    status: varchar('status', { length: 20 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('mock_customer_phone_idx').on(t.phone)],
);
