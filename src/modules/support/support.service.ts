/**
 * Support service — lean BFF orchestrator over the call-center + cskh-chat ports.
 * Methods are the former CQRS handlers' execute() bodies. Port names preserved
 * for downstream/mock contract.
 *
 * Chat = STORE-AND-FORWARD (Pc chốt 2026-08-19: tin phải được nhận kể cả khi
 * omnichannel_be đang chết):
 *  - sendMessage persist-first vào chat_outbox → trả {sent:true, messageId} NGAY.
 *    Wire failure không còn nằm trên response path; ChatOutboxForwarder đẩy nền.
 *  - getConversation MERGE thread omnichannel + outbox rows chưa echo (dedup theo
 *    messageId) → app luôn thấy tin của mình.
 */
import { randomUUID } from 'crypto';
import { Injectable, Inject } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { PortRegistry } from '@shared/port';
import { PortFallbackException } from '@shared/port/port-exceptions';
import { ValidationException } from '@core/common';
import { type DrizzleDB } from '@shared';
import { DATABASE_WRITE_TOKEN } from '@core/constants/tokens';
import { ClickToCallRequestSchema } from './dto/click-to-call.dto';
import type { ClickToCallResult, CallHistory } from './dto/call-center.dto';
import { SendMessageSchema } from './dto/cskh-chat.dto';
import type { SendMessageResult, GetConversationResult, ChatMessage } from './dto/cskh-chat.dto';
import { chatOutboxTable } from './infrastructure/persistence/drizzle/schema/chat-outbox.schema';
import { ChatOutboxForwarder } from './chat-outbox.forwarder';

@Injectable()
export class SupportService {
  constructor(
    private readonly portRegistry: PortRegistry,
    private readonly forwarder: ChatOutboxForwarder,
    @Inject(DATABASE_WRITE_TOKEN) private readonly db: DrizzleDB,
  ) {}

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

  /**
   * POST /call-center/message — persist-first (store-and-forward).
   * sent:true = "BFF đã nhận và chịu trách nhiệm giao" — KHÔNG phụ thuộc
   * omnichannel sống chết lúc này; forwarder đẩy khi wire sẵn sàng.
   */
  async sendMessage(userId: string, text: string): Promise<SendMessageResult> {
    const parsed = SendMessageSchema.safeParse({ userId, text });
    if (!parsed.success) {
      throw new ValidationException(parsed.error.message);
    }
    const messageId = randomUUID();
    await this.db.insert(chatOutboxTable).values({
      messageId,
      userId: parsed.data.userId,
      text: parsed.data.text,
    });
    // Best-effort đẩy NGAY (không await chặn response) — chết thì ticker sẽ thay.
    void this.forwarder.flushOnce().catch(() => undefined);
    return { sent: true, messageId };
  }

  /** GET /call-center/messages — omnichannel thread MERGE outbox rows (chưa echo). */
  async getConversation(userId: string): Promise<GetConversationResult> {
    const r = await this.portRegistry.execute<GetConversationResult>(
      'cskh-chat',
      'get-conversation',
      { userId },
    );
    const serverMessages = r?.data?.messages ?? [];
    const serverIds = new Set(serverMessages.map((m) => m.id));

    // Outbox rows của user này: forwarded rows đã (sẽ) echo trong server thread →
    // dedup loại; pending rows CHƯA tới omnichannel → chỉ thấy qua đây.
    const rows = await this.db
      .select()
      .from(chatOutboxTable)
      .where(eq(chatOutboxTable.userId, userId))
      .orderBy(asc(chatOutboxTable.createdAt));
    const localMessages: ChatMessage[] = rows
      .filter((row) => !serverIds.has(row.messageId))
      .map((row) => ({
        id: row.messageId,
        content: row.text,
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        createdAt: row.createdAt.toISOString(),
      }));

    const messages = [...serverMessages, ...localMessages].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    return { conversationId: r?.data?.conversationId ?? null, messages };
  }
}
