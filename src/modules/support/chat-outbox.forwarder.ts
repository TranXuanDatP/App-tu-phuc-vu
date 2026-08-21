/**
 * ChatOutboxForwarder — store-and-forward cho customer chat.
 *
 * POST /call-center/message persist-first vào chat_outbox và trả sent:true ngay;
 * forwarder NÀY là chân đẩy nền: ticker định kỳ lấy các row chưa forwarded và
 * POST lên omnichannel_be /webhooks/app qua port 'cskh-chat' (HMAC v1). MessageId
 * của row giữ nguyên qua mọi lần retry → receiver dedupe → idempotent, đẩy 2 lần
 * không nhân đôi tin.
 *
 * Failure semantics: 4xx của receiver (unauthorized/config) và infra (5xx/timeout/
 * unreachable) đều GIỮ row ở trạng thái pending — ticker thử lại ở chu kỳ sau.
 * Đây là dev-grade resilience (ticker đơn giản); khi cần exactly-once + backoff
 * thì thay bằng outbox pattern chuẩn (UoW + consumer) như incident-service plan.
 *
 * Lifecycle (lesson [[grpc-adapter-lifecycle]]): timer unref để không giữ process,
 * clearInterval khi module destroy.
 */
import { Injectable, Inject, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { asc, eq, isNull } from 'drizzle-orm';
import { type DrizzleDB } from '@shared';
import { DATABASE_WRITE_TOKEN } from '@core/constants/tokens';
import { PortRegistry } from '@shared/port';
import { chatOutboxTable } from './infrastructure/persistence/drizzle/schema/chat-outbox.schema';

const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_BATCH = 50;

@Injectable()
export class ChatOutboxForwarder implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('chat-outbox-forwarder');
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly portRegistry: PortRegistry,
    @Inject(DATABASE_WRITE_TOKEN) private readonly db: DrizzleDB,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.flushOnce().catch((e) => this.logger.warn(`flush ticker error: ${(e as Error).message}`));
    }, FLUSH_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Đẩy một batch row pending lên omnichannel. Trả về số row forwarded thành công.
   * Được gọi: (1) ngay sau mỗi sendMessage (best-effort, không chặn response),
   * (2) bởi ticker nền mỗi 10s.
   */
  async flushOnce(): Promise<number> {
    const pending = await this.db
      .select({
        messageId: chatOutboxTable.messageId,
        userId: chatOutboxTable.userId,
        text: chatOutboxTable.text,
      })
      .from(chatOutboxTable)
      .where(isNull(chatOutboxTable.forwardedAt))
      .orderBy(asc(chatOutboxTable.createdAt))
      .limit(FLUSH_BATCH);

    let forwarded = 0;
    for (const row of pending) {
      try {
        const r = await this.portRegistry.execute<{ sent: boolean }>('cskh-chat', 'send-message', {
          userId: row.userId,
          text: row.text,
          messageId: row.messageId,
        });
        if (r?.data?.sent) {
          await this.db
            .update(chatOutboxTable)
            .set({ forwardedAt: new Date() })
            .where(eq(chatOutboxTable.messageId, row.messageId));
          forwarded++;
        } else {
          // Receiver từ chối (4xx: secret lệch / thiếu config) — giữ pending, chờ cấu hình đúng.
          this.logger.warn(`row ${row.messageId} bị từ chối — giữ pending (check CSKH_WEBHOOK_HMAC_SECRET cả 2 phía)`);
        }
      } catch (e) {
        // Infra (5xx/timeout/unreachable) — circuit breaker đếm; giữ pending, ticker thử lại.
        this.logger.warn(`forward ${row.messageId} infra-fail: ${(e as Error).message}`);
      }
    }
    if (forwarded > 0) this.logger.log(`flushed ${forwarded}/${pending.length} outbox rows`);
    return forwarded;
  }
}
