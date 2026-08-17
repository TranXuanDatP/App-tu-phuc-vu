import { pgTable, varchar, timestamp, boolean, index } from 'drizzle-orm/pg-core';

/**
 * Binding Audit Table (SPEC-A4-A1 §A1.5) — append-only forensic log.
 * Mọi mutation binding → 1 row audit (bind-init resolve, bind verify attempt,
 * register branch, lockout trips). Viết bởi BindingService.writeAudit().
 *
 * Columns:
 *  - userId:      better-auth user id, RAW — joinable forensics (bảng nằm trong PG
 *      access-controlled của BFF; quyết định A1.5: hash chỉ dùng cho LOG lines,
 *      không hash trong DB).
 *  - customerRef: opaque resolve token (không PII), null khi chưa biết (vd resolve 'none').
 *  - action:      TS union (varchar theo convention customer_bindings.status) —
 *      spec enum 'challenge_attempt'|'bind'|'unbind'|'reverify' + extension:
 *        'register' — tạo verified-binding (creation = proof, §4): sự kiện security
 *            cấp bind, KHÔNG trộn vào bind-success (dashboard "bind success rate"
 *            sẽ bị nhiễu nếu gộp).
 *        'lockout'  — ceiling A1.4 vừa trip: signal anti-brute-force quan trọng
 *            nhất, `WHERE action='lockout'` là ops query tự nhiên.
 *      'unbind'/'reverify' chưa có writer (endpoint chưa tồn tại / A1.6 deferred)
 *      — giữ sẵn trong union theo spec để future không cần migration.
 *  - success:     kết quả của attempt (vd bind sai secret = false).
 *  - detail:      reason code máy đọc được (resolve:many N=2 | verify_failed |
 *      foreign_ref_rejected | lockout:session retrySec:900 | factor:… | …).
 *  - ip:          request.ip (Fastify @Ip) — sau LB là proxy address cho tới khi
 *      trustProxy được cấu hình (residual đã ghi nhận).
 *  - deviceInfo:  x-device-id header (nullable).
 */
export const bindingAuditTable = pgTable(
  'binding_audit',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 256 }).notNull(),
    customerRef: varchar('customer_ref', { length: 128 }),
    action: varchar('action', { length: 32 }).notNull(),
    success: boolean('success').notNull(),
    detail: varchar('detail', { length: 256 }),
    ip: varchar('ip', { length: 64 }),
    deviceInfo: varchar('device_info', { length: 512 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_binding_audit_user_id').on(t.userId),
    index('idx_binding_audit_created_at').on(t.createdAt),
  ],
);

export type BindingAuditRecord = typeof bindingAuditTable.$inferSelect;
export type NewBindingAuditRecord = typeof bindingAuditTable.$inferInsert;

export type BindingAuditAction =
  | 'challenge_attempt'
  | 'bind'
  | 'unbind' // future — không có endpoint hôm nay, giữ theo spec
  | 'reverify' // future — A1.6 deferred
  | 'register'
  | 'lockout';
