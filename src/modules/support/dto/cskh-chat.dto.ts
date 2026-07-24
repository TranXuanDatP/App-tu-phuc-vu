import { z } from 'zod';

/**
 * Customer chat → CSKH inbox (app-tu-phuc-vu → omichannel_be /webhooks/app).
 */
export const SendMessageSchema = z.object({
  userId: z.string().min(1),
  text: z.string().min(1).max(2000),
});
export type SendMessageRequest = z.infer<typeof SendMessageSchema>;

export interface SendMessageResult {
  sent: boolean;
  conversationId?: string;
  messageId?: string;
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
