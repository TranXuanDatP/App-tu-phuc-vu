/**
 * Mock adapter for the proactive-notification port (downstream proactive
 * communication service). Reads mocks/proactive-notification/<method>.json.
 * Swap to a real InternalAdapterBase subclass (passed as the 2nd arg of
 * portRegistry.register) when the downstream service is ready.
 *
 * Methods: get-active-alerts, get-alert-history, acknowledge-alert
 */
import { Injectable, Logger } from '@nestjs/common';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import {
  GetActiveAlertsResponseSchema,
  AlertHistoryResponseSchema,
  AcknowledgeAlertResponseSchema,
} from '../dto/proactive-notification.dto';

@Injectable()
export class MockProactiveNotificationAdapter extends MockAdapterBase {
  constructor() {
    super(
      'proactive-notification',
      {
        'get-active-alerts': GetActiveAlertsResponseSchema,
        'get-alert-history': AlertHistoryResponseSchema,
        'acknowledge-alert': AcknowledgeAlertResponseSchema,
      },
      new Logger('proactive-notification-mock-adapter'),
    );
  }
}
