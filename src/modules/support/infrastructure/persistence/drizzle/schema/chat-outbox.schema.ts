import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * Chat Outbox Table — store-and-forward cho customer chat (Pc chốt 2026-08-19:
 * "kể cả khi omnichannel không bật thì tin nhắn cũng phải được gửi đi").
 *
 * INSERT-first: POST /call-center/message persist vào đây và trả sent:true NGAY —
 * downstream (omnichannel_be /webhooks/app) không nằm trên đường critical path.
 * ChatOutboxForwarder đẩy các row chưa forwarded nền (messageId idempotent —
 * receiver dedupe theo messageId nên retry an toàn). get-conversation MERGE
 * thread từ omnichannel với các row này (dedup theo messageId) → app luôn thấy
 * tin của mình, kể cả khi tin chưa (hoặc chưa thể) tới omnichannel.
 */
export const chatOutboxTable = pgTable(
  'chat_outbox',
  {
    /** UUID do BFF sinh — giữ ổn định qua các lần retry forward (idempotency key). */
    messageId: uuid('message_id').primaryKey(),
    /** better-auth user id (identity của người gửi). */
    userId: varchar('user_id', { length: 64 }).notNull(),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** NULL = pending (chưa đẩy được lên omnichannel). */
    forwardedAt: timestamp('forwarded_at', { withTimezone: true }),
  },
  (t) => [index('chat_outbox_user_idx').on(t.userId)],
);
