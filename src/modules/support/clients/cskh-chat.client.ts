/**
 * CSKH Chat adapter — forward customer message (app) → omichannel_be /webhooks/app.
 *
 * Inbound đa kênh: customer chat trong app reach CSKH agent inbox. omichannel_be
 * normalize `{userId, messageId, text}` → channel APP, conversation keyed by
 * (APP, userId). Config-gated bởi `CSKH_WEBHOOK_URL`: set → HTTP POST /webhooks/app;
 * unset → mock (log, không forward).
 *
 * Port-adapter (IPortAdapter) — method `send-message`. Register qua PortRegistry
 * (support.module.ts) cùng port name 'cskh-chat'.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IPortAdapter } from '@shared/port/port.interface';
import type { GetConversationResult } from '../dto/cskh-chat.dto';

export interface AppWebhookPayload {
  userId: string;
  messageId: string;
  text?: string;
  attachments?: { url: string }[];
}

@Injectable()
export class CskhChatAdapter implements IPortAdapter {
  private readonly logger = new Logger('cskh-chat-adapter');
  private readonly appWebhookUrl?: string;

  constructor(private readonly config: ConfigService) {
    const base = this.config.get<string>('CSKH_WEBHOOK_URL');
    this.appWebhookUrl = base ? `${base.replace(/\/$/, '')}/webhooks/app` : undefined;
    if (this.appWebhookUrl) {
      this.logger.log(`customer chat → ${this.appWebhookUrl}`);
    }
  }

  async execute(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method === 'send-message') {
      return this.sendMessage(params as { userId: string; text: string });
    }
    if (method === 'get-conversation') {
      return this.getConversation(params as { userId: string });
    }
    throw new Error(`cskh-chat: unsupported method '${method}'`);
  }

  private async sendMessage({
    userId,
    text,
  }: {
    userId: string;
    text: string;
  }): Promise<{ sent: boolean; conversationId?: string; messageId?: string }> {
    if (!this.appWebhookUrl) {
      this.logger.log(`[mock] chat userId=${userId} text="${text.slice(0, 40)}"`);
      return { sent: true };
    }
    const messageId = `app-${userId}-${Date.now()}`;
    const payload: AppWebhookPayload = { userId, messageId, text };
    try {
      const res = await fetch(this.appWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const raw = (await res.json().catch(() => null)) as {
        data?: { ok?: boolean; conversationId?: string; messageId?: string };
        conversationId?: string; // fallback nếu response không envelope
        messageId?: string;
      } | null;
      const data = raw?.data ?? raw;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.logger.log(
        `chat → cskh conv=${data?.conversationId ?? '?'} msg=${data?.messageId ?? messageId}`,
      );
      return { sent: true, conversationId: data?.conversationId, messageId: data?.messageId };
    } catch (e) {
      const err = e as Error;
      this.logger.warn(`cskh chat forward failed: ${err.message}`);
      return { sent: false };
    }
  }

  /** get-conversation — read the customer's active APP thread (history + staff replies). */
  private async getConversation({
    userId,
  }: {
    userId: string;
  }): Promise<GetConversationResult> {
    if (!this.appWebhookUrl) {
      this.logger.log(`[mock] get-conversation userId=${userId}`);
      return { conversationId: null, messages: [] };
    }
    const url = `${this.appWebhookUrl}/conversation?userId=${encodeURIComponent(userId)}`;
    try {
      const res = await fetch(url, { method: 'GET' });
      const raw = (await res.json().catch(() => null)) as
        | ({ data?: GetConversationResult } & Partial<GetConversationResult>)
        | null;
      const data = (raw?.data ?? raw) as GetConversationResult | null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return {
        conversationId: data?.conversationId ?? null,
        messages: Array.isArray(data?.messages) ? data.messages : [],
      };
    } catch (e) {
      const err = e as Error;
      this.logger.warn(`cskh get-conversation failed: ${err.message}`);
      return { conversationId: null, messages: [] };
    }
  }
}
