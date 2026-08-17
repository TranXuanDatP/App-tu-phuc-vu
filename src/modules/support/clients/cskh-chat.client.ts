/**
 * CSKH Chat adapter — forward customer message (app) → omichannel_be /webhooks/app.
 *
 * Inbound đa kênh: customer chat trong app reach CSKH agent inbox. omichannel_be
 * normalize `{userId, messageId, text}` → channel APP, conversation keyed by
 * (APP, userId). Config-gated bởi `CSKH_WEBHOOK_URL`: set → HTTP POST /webhooks/app;
 * unset → mock (log, không forward).
 *
 * WIRE AUTH (HMAC v1): mọi request (POST + GET) đều ký bằng CSKH_WEBHOOK_HMAC_SECRET
 * → headers x-timestamp + x-signature (canonical string: docs/cskh-chat-webhook-auth.md).
 * Receiver (omnichannel_be WebhookHmacGuard) fail-closed — không ký = 401. GET ký cả
 * query string nên userId tamper-proof (đóng IDOR thread-read ở tầng transport).
 *
 * Failure semantics: auth (401/403) + missing-secret là caller/config problem →
 * trả `{sent:false, reason}` (KHÔNG throw — 4xx không trip circuit breaker theo thiết
 * kế registry). Infra (5xx/timeout/unreachable) → throw PortDownstreamException/
 * PortTimeoutException để CB đếm failure; SupportService map lại FE shape.
 *
 * KHÔNG dùng PortHttpClient cho wire này: nó inject Bearer JWT (receiver không verify
 * được) và retry-401 sẽ resend HMAC stale. Borrow mỗi timeout 3s (AbortSignal).
 *
 * Port-adapter (IPortAdapter) — method `send-message`. Register qua PortRegistry
 * (support.module.ts) cùng port name 'cskh-chat'.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type { IPortAdapter } from '@shared/port/port.interface';
import {
  PortDownstreamException,
  PortTimeoutException,
} from '@shared/port/port-exceptions';
import { signWebhook } from '@shared/security/hmac-sign.util';
import type { GetConversationResult } from '../dto/cskh-chat.dto';

export interface AppWebhookPayload {
  userId: string;
  messageId: string;
  text?: string;
  attachments?: { url: string }[];
}

/** Timeout cho 1 lần gọi wire (ms) — chat là best-effort, không giữ request dài. */
const WIRE_TIMEOUT_MS = 3_000;

@Injectable()
export class CskhChatAdapter implements IPortAdapter {
  private readonly logger = new Logger('cskh-chat-adapter');
  private readonly appWebhookUrl?: string;
  private readonly hmacSecret?: string;

  constructor(private readonly config: ConfigService) {
    const base = this.config.get<string>('CSKH_WEBHOOK_URL');
    this.appWebhookUrl = base ? `${base.replace(/\/$/, '')}/webhooks/app` : undefined;
    // Fail-closed counterpart: receiver rejects everything without the secret, so a
    // URL-without-secret config is a guaranteed-broken wire — alarm now, per-call
    // degrade with reason:'config' (không crash-loop pod trên dev cluster).
    this.hmacSecret = this.config.get<string>('CSKH_WEBHOOK_HMAC_SECRET') || undefined;
    if (this.appWebhookUrl) {
      this.logger.log(`customer chat → ${this.appWebhookUrl}`);
      if (!this.hmacSecret) {
        this.logger.error(
          'CSKH_WEBHOOK_URL is set but CSKH_WEBHOOK_HMAC_SECRET is not — every call will be rejected (401) by the receiver',
        );
      }
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
  }): Promise<{ sent: boolean; conversationId?: string; messageId?: string; reason?: string }> {
    if (!this.appWebhookUrl) {
      this.logger.log(`[mock] chat userId=${userId} text="${text.slice(0, 40)}"`);
      return { sent: true };
    }
    if (!this.hmacSecret) {
      return { sent: false, reason: 'config' };
    }
    // randomUUID thay vì `app-${userId}-${Date.now()}`: bỏ pattern predictable +
    // same-millisecond collision (receiver dedupe theo messageId sẽ nuốt nhầm duplicate).
    const messageId = randomUUID();
    const payload: AppWebhookPayload = { userId, messageId, text };
    const body = JSON.stringify(payload);
    try {
      const res = await fetch(this.appWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...signWebhook(this.hmacSecret, 'POST', this.appWebhookUrl, body),
        },
        body,
        signal: AbortSignal.timeout(WIRE_TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 403) {
        // Caller/config problem (secret mismatch / receiver chưa set secret) —
        // KHÔNG throw: 4xx không trip CB theo errorFilter của registry.
        this.logger.error(`cskh chat rejected by receiver: HTTP ${res.status} (check CSKH_WEBHOOK_HMAC_SECRET both sides)`);
        return { sent: false, reason: 'unauthorized' };
      }
      if (!res.ok) {
        throw new PortDownstreamException('cskh-chat', res.status, res.statusText, this.appWebhookUrl);
      }
      const raw = (await res.json().catch(() => null)) as {
        data?: { ok?: boolean; conversationId?: string; messageId?: string };
        conversationId?: string; // fallback nếu response không envelope
        messageId?: string;
      } | null;
      const data = raw?.data ?? raw;
      this.logger.log(
        `chat → cskh conv=${data?.conversationId ?? '?'} msg=${data?.messageId ?? messageId}`,
      );
      return { sent: true, conversationId: data?.conversationId, messageId: data?.messageId };
    } catch (e) {
      const err = e as Error;
      // Typed port exceptions pass through (CB failure path); abort → PortTimeout;
      // network reject → downstream-unreachable (unknown errors count as infra).
      if (err instanceof PortDownstreamException) throw err;
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new PortTimeoutException('cskh-chat', WIRE_TIMEOUT_MS);
      }
      throw new PortDownstreamException('cskh-chat', 0, `unreachable: ${err.message}`, this.appWebhookUrl);
    }
  }

  /** get-conversation — read the customer's active APP thread (history + staff replies).
   * Read path soft-fail: mọi lỗi → empty thread + log (FE degrade, không crash UX);
   * auth failure log ERROR để dev thấy ngay wire secret lệch. */
  private async getConversation({
    userId,
  }: {
    userId: string;
  }): Promise<GetConversationResult> {
    if (!this.appWebhookUrl) {
      this.logger.log(`[mock] get-conversation userId=${userId}`);
      return { conversationId: null, messages: [] };
    }
    if (!this.hmacSecret) {
      this.logger.error('get-conversation skipped: CSKH_WEBHOOK_HMAC_SECRET not set');
      return { conversationId: null, messages: [] };
    }
    const url = `${this.appWebhookUrl}/conversation?userId=${encodeURIComponent(userId)}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { ...signWebhook(this.hmacSecret, 'GET', url) }, // query nằm trong canonical → userId tamper-proof
        signal: AbortSignal.timeout(WIRE_TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 403) {
        this.logger.error(`cskh get-conversation rejected: HTTP ${res.status} (check CSKH_WEBHOOK_HMAC_SECRET both sides)`);
        return { conversationId: null, messages: [] };
      }
      if (!res.ok) {
        this.logger.warn(`cskh get-conversation failed: HTTP ${res.status}`);
        return { conversationId: null, messages: [] };
      }
      const raw = (await res.json().catch(() => null)) as
        | ({ data?: GetConversationResult } & Partial<GetConversationResult>)
        | null;
      const data = (raw?.data ?? raw) as GetConversationResult | null;
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
