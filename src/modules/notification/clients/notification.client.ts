/**
 * Mock adapter for the notification port (downstream Notification service).
 * Reads mocks/notification/<method>.json. Swap to a real InternalAdapterBase
 * subclass (passed as the 2nd arg of portRegistry.register) when the downstream
 * service is ready — flip config/api-endpoints.yaml `adapter: live`.
 *
 * Methods: dispatch-notification, get-notification-preferences,
 *          update-notification-preferences, get-notification-history
 */
import { Injectable, Logger } from '@nestjs/common';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import { DispatchNotificationResultSchema, SendOtpResultSchema } from '../dto/notification.dto';
import {
  NotificationPreferencesResponseSchema,
  UpdateNotificationPreferencesResponseSchema,
  NotificationHistoryResponseSchema,
} from '../dto/notification-preferences.dto';

@Injectable()
export class MockNotificationAdapter extends MockAdapterBase {
  constructor() {
    super(
      'notification',
      {
        'dispatch-notification': DispatchNotificationResultSchema,
        'send-otp': SendOtpResultSchema,
        'get-notification-preferences': NotificationPreferencesResponseSchema,
        'update-notification-preferences': UpdateNotificationPreferencesResponseSchema,
        'get-notification-history': NotificationHistoryResponseSchema,
      },
      new Logger('notification-mock-adapter'),
    );
  }
}
