/**
 * Notification module — lean BFF module (4-part: controller + service + dto + clients).
 * Registers the notification + proactive-notification mock ports via onModuleInit.
 * No domain/, no CQRS handlers.
 *
 * Ports in this module:
 *   proactive-notification — cacheTier: dynamic (5-15 min cache, FR50-FR53)
 *   notification           — cacheTier: dynamic (FR54-FR55 — dispatch + prefs/history)
 *
 * The migrated getCutoffSchedule reads the `water-cutoff` port, which is still
 * registered by WaterCutoffModule (the water-cutoff module will be deleted later).
 *
 * Pattern: ...TicketModule → NotificationModule → AuthPropagationModule → PortModule
 */
import { Module, OnModuleInit } from '@nestjs/common';
import { PortRegistry } from '@shared/port';
import { NotificationController, ProactiveNotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { MockNotificationAdapter } from './clients/notification.client';
import { MockProactiveNotificationAdapter } from './clients/proactive-notification.client';
import { MockWaterCutoffAdapter } from './clients/water-cutoff.client';
import { KeycloakSaTokenService } from './clients/keycloak-sa-token.service';
import { NotificationGrpcAdapter } from './clients/notification-grpc.client';

@Module({
  controllers: [NotificationController, ProactiveNotificationController],
  providers: [
    NotificationService,
    MockNotificationAdapter,
    MockProactiveNotificationAdapter,
    MockWaterCutoffAdapter,
    KeycloakSaTokenService,
    NotificationGrpcAdapter,
  ],
})
export class NotificationModule implements OnModuleInit {
  constructor(
    private readonly portRegistry: PortRegistry,
    private readonly mockNotificationAdapter: MockNotificationAdapter,
    private readonly mockProactiveNotificationAdapter: MockProactiveNotificationAdapter,
    private readonly mockWaterCutoffAdapter: MockWaterCutoffAdapter,
    private readonly notificationGrpcAdapter: NotificationGrpcAdapter,
  ) {}

  /**
   * Register ports with PortRegistry on module init.
   * notification           — dynamic tier (dispatch + prefs/history)
   * proactive-notification — dynamic tier (alerts)
   * water-cutoff           — migrated from the deleted water-cutoff module (cutoff schedule read)
   */
  onModuleInit() {
    // notification: mock for reads (prefs/history/dispatch), gRPC adapter as LIVE
    // → send-otp goes to notification-be-rs when NOTIFICATION_GRPC_URL is set.
    this.portRegistry.register(
      'notification',
      this.mockNotificationAdapter,
      this.notificationGrpcAdapter,
    );
    this.portRegistry.register(
      'proactive-notification',
      this.mockProactiveNotificationAdapter,
      this.mockProactiveNotificationAdapter,
    );
    this.portRegistry.register(
      'water-cutoff',
      this.mockWaterCutoffAdapter,
      this.mockWaterCutoffAdapter,
    );
  }
}
