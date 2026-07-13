/**
 * Dispatch Notification Handler (AC#1, #2, #3 — FR54/FR55)
 *
 * Central notification funnel:
 * 1. Rate limit check per channel via RedisRateLimiterService
 * 2. If allowed → dispatch via INotificationPort
 * 3. If critical + rate limited → fallback chain (ZNS → Push → In-App)
 * 4. If non-critical + rate limited → DROP with audit log
 * 5. Record session event via RecordSessionEventCommand
 */

import { ICommandHandler, CommandHandler, CommandBus } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { PortRegistry } from '@shared/port';
import { DispatchNotificationCommand } from '../dispatch-notification.command';
import type { DispatchNotificationResult, NotificationChannel } from '../../dtos/notification.dto';
import type { PortResult } from '@shared/port/port.interface';
import { RedisRateLimiterService } from '../../../infrastructure/rate-limiter/redis-rate-limiter.service';
import { RecordSessionEventCommand } from '@modules/session/application/commands/record-session-event.command';

@CommandHandler(DispatchNotificationCommand)
export class DispatchNotificationHandler
  implements ICommandHandler<DispatchNotificationCommand>
{
  private readonly logger = new Logger(DispatchNotificationHandler.name);

  constructor(
    private readonly portRegistry: PortRegistry,
    private readonly rateLimiterService: RedisRateLimiterService,
    private readonly commandBus: CommandBus,
  ) {}

  async execute(command: DispatchNotificationCommand): Promise<DispatchNotificationResult> {
    const { customerId, type, isCritical, channel } = command.payload;

    // Determine target channel(s)
    // Pc (2026-07-13): App-only notifications — no SMS/Zalo/email.
    // Default = push (FCM when app in background). Critical fallback: push → in_app.
    const targetChannel: NotificationChannel = channel ?? 'push';
    const fallbackChain: NotificationChannel[] = isCritical ? ['push', 'in_app'] : [targetChannel];

    // Try each channel in the fallback chain
    const attemptedChannels: NotificationChannel[] = [];

    for (const ch of fallbackChain) {
      const rateCheck = await this.rateLimiterService.check(customerId, ch);

      if (rateCheck.allowed) {
        // Dispatch via notification port
        const result: PortResult<DispatchNotificationResult> =
          await this.portRegistry.execute<DispatchNotificationResult>(
            'notification',
            'dispatch-notification',
            { ...command.payload, channel: ch, useCache: false },
          );

        if (!result?.data) {
          this.logger.warn(`Notification port returned null for channel ${ch}`);
          attemptedChannels.push(ch);
          continue;
        }

        // AC#3: Record session event via RecordSessionEventCommand
        try {
          await this.commandBus.execute(
            new RecordSessionEventCommand({
              userId: customerId,
              eventType: 'notification_sent',
              channel: 'app', // App-only — every notification originates in the App touchpoint
              content: { channel: ch, notificationType: type },
            }),
          );
        } catch (err) {
          this.logger.warn(`Session event recording failed: ${(err as Error).message}`);
        }

        this.logger.log(`Notification dispatched: ${type} via ${ch} to ${customerId}`);

        return {
          dispatched: true,
          channel: ch,
          rateLimited: false,
          fallbackChain: attemptedChannels.length > 0 ? attemptedChannels : undefined,
        };
      }

      // Rate limited — try next channel in fallback
      attemptedChannels.push(ch);
      this.logger.log(
        `Rate limited on ${ch}, trying next fallback (attempted: ${attemptedChannels.join(' → ')})`,
      );
    }

    // All channels exhausted
    if (isCritical) {
      // This should NOT happen — in_app has no limit
      this.logger.error(
        `CRITICAL notification dropped: ${type} to ${customerId}. All channels exhausted!`,
      );
      return {
        dispatched: false,
        channel: targetChannel,
        rateLimited: true,
        fallbackChain: attemptedChannels,
      };
    }

    // Non-critical — drop with audit log
    this.logger.log(
      `[AUDIT] Non-critical notification dropped: ${type} to ${customerId}. Rate limited on: ${attemptedChannels.join(', ')}`,
    );

    return {
      dispatched: false,
      channel: targetChannel,
      rateLimited: true,
      fallbackChain: attemptedChannels,
    };
  }
}
