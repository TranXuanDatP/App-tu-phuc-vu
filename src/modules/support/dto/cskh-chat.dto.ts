import { z } from 'zod';

/**
 * Customer chat → CSKH inbox (app-tu-phuc-vu → omichannel_be /webhooks/app).
 */
export const SendMessageSchema = z.object({
  userId: z.string().min(1),
  text: z.string().min(1).max(2000),
  /** Forwarder truyền messageId của outbox row để retry idempotent (receiver dedupe).
   * Client KHÔNG truyền — BFF tự sinh khi nhận tin mới. */
  messageId: z.string().uuid().optional(),
});
export type SendMessageRequest = z.infer<typeof SendMessageSchema>;

/** Vì sao gửi thất bại (operational signal cho FE + log):
 * - unauthorized: receiver từ chối chữ ký (401/403) — secret lệch 2 phía.
 * - config: CSKH_WEBHOOK_URL set nhưng CSKH_WEBHOOK_HMAC_SECRET thiếu.
 * - server-error: infra (5xx/timeout/unreachable) — adapter throw typed exception
 *   (circuit breaker đếm), service map về shape này. */
export type SendMessageFailureReason = 'unauthorized' | 'config' | 'server-error';

export interface SendMessageResult {
  sent: boolean;
  conversationId?: string;
  messageId?: string;
  reason?: SendMessageFailureReason;
}

/** One chat message in the customer↔staff thread (mirrors omnichannel messages). */
export interface ChatMessage {
  id: string;
  content: string;
  /** INBOUND = from customer (app); OUTBOUND = from agent (staff reply). */
  direction: 'INBOUND' | 'OUTBOUND';
  senderType: 'CUSTOMER' | 'AGENT' | 'BOT' | 'SYSTEM';
  createdAt: string;
}

/** GET /call-center/messages — the customer's active conversation thread. */
export interface GetConversationResult {
  conversationId: string | null;
  messages: ChatMessage[];
}
