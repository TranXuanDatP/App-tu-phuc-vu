/**
 * Support service — lean BFF orchestrator over the call-center port.
 * Thin pass-through to PortRegistry; no business logic. Methods are the former
 * CQRS handlers' execute() bodies (get-call-history, create-click-to-call).
 * Port name 'call-center' preserved for downstream/mock contract.
 */
import { Injectable } from '@nestjs/common';
import { PortRegistry } from '@shared/port';
import { PortException, PortFallbackException } from '@shared/port/port-exceptions';
import { ValidationException } from '@core/common';
import { ClickToCallRequestSchema } from './dto/click-to-call.dto';
import type { ClickToCallResult, CallHistory } from './dto/call-center.dto';
import { SendMessageSchema } from './dto/cskh-chat.dto';
import type { SendMessageResult, GetConversationResult } from './dto/cskh-chat.dto';

@Injectable()
export class SupportService {
  constructor(private readonly portRegistry: PortRegistry) {}

  /** GET /call-center/history — former GetCallHistoryHandler.execute(). */
  async getCallHistory(customerId: string): Promise<CallHistory> {
    const r = await this.portRegistry.execute<CallHistory>(
      'call-center',
      'get-call-history',
      { customerId },
    );
    if (!r?.data) throw new PortFallbackException('call-center');
    return r.data;
  }

  /** POST /call-center/click-to-call — former CreateClickToCallHandler.execute(). */
  async createClickToCall(customerId: string, body: unknown): Promise<ClickToCallResult> {
    const parsed = ClickToCallRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.message);
    }
    const r = await this.portRegistry.execute<ClickToCallResult>(
      'call-center',
      'create-click-to-call',
      { customerId, phoneNumber: parsed.data.phoneNumber, useCache: false },
    );
    if (!r?.data) throw new PortFallbackException('call-center');
    return r.data;
  }

  /** POST /call-center/message — forward customer chat → CSKH inbox (omichannel_be /webhooks/app). */
  async sendMessage(userId: string, text: string): Promise<SendMessageResult> {
    const parsed = SendMessageSchema.safeParse({ userId, text });
    if (!parsed.success) {
      throw new ValidationException(parsed.error.message);
    }
    try {
      const r = await this.portRegistry.execute<SendMessageResult>(
        'cskh-chat',
        'send-message',
        { userId, text },
      );
      return r?.data ?? { sent: false };
    } catch (e) {
      // Infra failure (5xx/timeout/unreachable): adapter throws typed PortException
      // để circuit breaker đếm (errorFilter chỉ tính infra, 4xx thì adapter đã trả
      // reason chứ không throw). Map về FE shape ở đây — user thấy "gửi thất bại",
      // không phải 5xx crash. Lỗi khác (PortNotRegistered = bug) vẫn rethrow.
      if (e instanceof PortException) {
        return { sent: false, reason: 'server-error' };
      }
      throw e;
    }
  }

  /** GET /call-center/messages — the customer's active chat thread (history + staff replies). */
  async getConversation(userId: string): Promise<GetConversationResult> {
    const r = await this.portRegistry.execute<GetConversationResult>(
      'cskh-chat',
      'get-conversation',
      { userId },
    );
    return r?.data ?? { conversationId: null, messages: [] };
  }
}
