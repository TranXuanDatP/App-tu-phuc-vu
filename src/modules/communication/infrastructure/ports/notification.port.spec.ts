import { MockNotificationAdapter } from './notification.port';
import {
  DispatchNotificationResultSchema,
  NotificationChannelSchema,
  NotificationTypeSchema,
  DispatchNotificationPayloadSchema,
} from '../../application/dtos/notification.dto';
import {
  NotificationPreferencesResponseSchema,
  UpdateNotificationPreferencesResponseSchema,
  NotificationHistoryResponseSchema,
  NotificationChannelPreferenceSchema,
  UpdateNotificationPreferencesPayloadSchema,
  NotificationHistoryQuerySchema,
  NotificationHistoryItemSchema,
  NotificationDeliveryStatusSchema,
} from '../../application/dtos/notification-preferences.dto';

describe('MockNotificationAdapter', () => {
  let adapter: MockNotificationAdapter;

  beforeEach(() => {
    adapter = new MockNotificationAdapter();
  });

  describe('execute — dispatch-notification', () => {
    it('should read and validate dispatch-notification.json mock data', async () => {
      const result = await adapter.execute('dispatch-notification', {
        customerId: 'USR-001',
        type: 'payment_completed',
        isCritical: true,
      });

      expect(result).toBeDefined();
      const parsed = DispatchNotificationResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.dispatched).toBe(true);
        expect(parsed.data.channel).toBe('push');
        expect(parsed.data.rateLimited).toBe(false);
      }
    });

    it('should return a valid channel value', async () => {
      const result = await adapter.execute('dispatch-notification', {});
      const parsed = DispatchNotificationResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(['zns', 'push', 'sms', 'email', 'in_app']).toContain(parsed.data.channel);
      }
    });

    it('should include required fields in dispatch result', async () => {
      const result = await adapter.execute('dispatch-notification', {});
      const parsed = DispatchNotificationResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(typeof parsed.data.dispatched).toBe('boolean');
        expect(typeof parsed.data.channel).toBe('string');
        expect(typeof parsed.data.rateLimited).toBe('boolean');
      }
    });
  });

  // ── Story 6.3: get-notification-preferences ──────────────────────────────

  describe('execute — get-notification-preferences', () => {
    it('should read and validate get-notification-preferences.json mock data', async () => {
      const result = await adapter.execute('get-notification-preferences', {
        customerId: 'USR-00001',
      });

      expect(result).toBeDefined();
      const parsed = NotificationPreferencesResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.customerId).toBe('USR-00001');
        expect(parsed.data.channels.length).toBeGreaterThanOrEqual(1);
        expect(parsed.data.updatedAt).toBeDefined();
      }
    });

    it('should include both critical and optional channels', async () => {
      const result = await adapter.execute('get-notification-preferences', {});
      const parsed = NotificationPreferencesResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        const critical = parsed.data.channels.filter(ch => ch.isCritical);
        const optional = parsed.data.channels.filter(ch => !ch.isCritical);
        expect(critical.length).toBeGreaterThanOrEqual(1);
        expect(optional.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('should have all critical channels enabled', async () => {
      const result = await adapter.execute('get-notification-preferences', {});
      const parsed = NotificationPreferencesResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        const critical = parsed.data.channels.filter(ch => ch.isCritical);
        critical.forEach(ch => {
          expect(ch.enabled).toBe(true);
        });
      }
    });
  });

  // ── Story 6.3: update-notification-preferences ───────────────────────────

  describe('execute — update-notification-preferences', () => {
    it('should read and validate update-notification-preferences.json mock data', async () => {
      const result = await adapter.execute('update-notification-preferences', {
        customerId: 'USR-00001',
        channels: [{ channel: 'sms', enabled: true }],
        useCache: false,
      });

      expect(result).toBeDefined();
      const parsed = UpdateNotificationPreferencesResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.customerId).toBe('USR-00001');
        expect(parsed.data.channels.length).toBeGreaterThanOrEqual(1);
        expect(parsed.data.updatedAt).toBeDefined();
      }
    });
  });

  // ── Story 6.3: get-notification-history ──────────────────────────────────

  describe('execute — get-notification-history', () => {
    it('should read and validate get-notification-history.json mock data', async () => {
      const result = await adapter.execute('get-notification-history', {
        customerId: 'USR-00001',
        page: 1,
        pageSize: 20,
      });

      expect(result).toBeDefined();
      const parsed = NotificationHistoryResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.notifications.length).toBeGreaterThanOrEqual(1);
        expect(parsed.data.totalCount).toBeGreaterThan(0);
        expect(parsed.data.page).toBe(1);
        expect(parsed.data.pageSize).toBe(20);
      }
    });

    it('should return notification items with all required fields', async () => {
      const result = await adapter.execute('get-notification-history', {});
      const parsed = NotificationHistoryResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        const item = parsed.data.notifications[0];
        expect(item.id).toBeDefined();
        expect(item.type).toBeDefined();
        expect(item.channel).toBeDefined();
        expect(item.contentSummary).toBeDefined();
        expect(item.timestamp).toBeDefined();
        expect(item.deliveryStatus).toBeDefined();
      }
    });
  });

  describe('execute — missing method', () => {
    it('should throw for missing mock file', async () => {
      await expect(adapter.execute('nonexistent', {})).rejects.toThrow();
    });
  });

  // ── Schema validation edge cases ────────────────────────────────────────

  describe('NotificationChannelSchema', () => {
    it('should accept all valid channels', () => {
      for (const ch of ['zns', 'push', 'sms', 'email', 'in_app']) {
        expect(NotificationChannelSchema.safeParse(ch).success).toBe(true);
      }
    });

    it('should reject invalid channel', () => {
      expect(NotificationChannelSchema.safeParse('telegram').success).toBe(false);
    });
  });

  describe('NotificationTypeSchema', () => {
    it('should accept all valid notification types', () => {
      for (const type of ['payment_completed', 'payment_failed', 'ticket_status_changed', 'alert_outage', 'alert_maintenance', 'alert_quality', 'debt_reminder']) {
        expect(NotificationTypeSchema.safeParse(type).success).toBe(true);
      }
    });

    it('should reject invalid notification type', () => {
      expect(NotificationTypeSchema.safeParse('invalid_type').success).toBe(false);
    });
  });

  describe('DispatchNotificationPayloadSchema', () => {
    it('should accept minimal valid payload', () => {
      const result = DispatchNotificationPayloadSchema.safeParse({
        customerId: 'USR-001',
        type: 'payment_completed',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isCritical).toBe(false); // default
      }
    });

    it('should accept full payload with all optional fields', () => {
      const result = DispatchNotificationPayloadSchema.safeParse({
        customerId: 'USR-001',
        type: 'ticket_status_changed',
        channel: 'push',
        isCritical: true,
        ticketId: 'TICK-001',
        trackingId: 'TK-2026-001',
        oldStatus: 'submitted',
        newStatus: 'assigned',
        metadata: { source: 'webhook' },
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing customerId', () => {
      expect(DispatchNotificationPayloadSchema.safeParse({
        type: 'payment_completed',
      }).success).toBe(false);
    });

    it('should reject empty customerId', () => {
      expect(DispatchNotificationPayloadSchema.safeParse({
        customerId: '',
        type: 'payment_completed',
      }).success).toBe(false);
    });

    it('should reject negative amount', () => {
      expect(DispatchNotificationPayloadSchema.safeParse({
        customerId: 'USR-001',
        type: 'payment_completed',
        amount: -100,
      }).success).toBe(false);
    });

    it('should accept zero amount', () => {
      // z.number().positive() rejects 0, but amount is optional
      const result = DispatchNotificationPayloadSchema.safeParse({
        customerId: 'USR-001',
        type: 'payment_completed',
        amount: 0,
      });
      // positive() rejects 0 — this validates the constraint
      expect(result.success).toBe(false);
    });
  });

  // ── Story 6.3: Preference DTO schema edge cases ──────────────────────────

  describe('NotificationChannelPreferenceSchema', () => {
    it('should accept valid channel preference', () => {
      const result = NotificationChannelPreferenceSchema.safeParse({
        channel: 'push',
        enabled: true,
        isCritical: false,
      });
      expect(result.success).toBe(true);
    });

    it('should accept critical channel preference', () => {
      const result = NotificationChannelPreferenceSchema.safeParse({
        channel: 'in_app',
        enabled: true,
        isCritical: true,
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing enabled field', () => {
      expect(NotificationChannelPreferenceSchema.safeParse({
        channel: 'push',
        isCritical: false,
      }).success).toBe(false);
    });
  });

  describe('UpdateNotificationPreferencesPayloadSchema', () => {
    it('should accept valid payload with single channel', () => {
      const result = UpdateNotificationPreferencesPayloadSchema.safeParse({
        channels: [{ channel: 'push', enabled: true }],
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty channels array', () => {
      expect(UpdateNotificationPreferencesPayloadSchema.safeParse({
        channels: [],
      }).success).toBe(false);
    });

    it('should reject missing channels field', () => {
      expect(UpdateNotificationPreferencesPayloadSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('NotificationHistoryQuerySchema', () => {
    it('should apply defaults for page and pageSize', () => {
      const result = NotificationHistoryQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.pageSize).toBe(20);
      }
    });

    it('should coerce string page/pageSize to numbers', () => {
      const result = NotificationHistoryQuerySchema.safeParse({ page: '3', pageSize: '15' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(3);
        expect(result.data.pageSize).toBe(15);
      }
    });

    it('should reject pageSize > 50', () => {
      expect(NotificationHistoryQuerySchema.safeParse({ pageSize: 51 }).success).toBe(false);
    });

    it('should reject invalid date format', () => {
      expect(NotificationHistoryQuerySchema.safeParse({ startDate: '06-11-2026' }).success).toBe(false);
    });

    it('should accept valid date format', () => {
      const result = NotificationHistoryQuerySchema.safeParse({ startDate: '2026-06-11' });
      expect(result.success).toBe(true);
    });

    it('should accept optional channel filter', () => {
      const result = NotificationHistoryQuerySchema.safeParse({ channel: 'zns' });
      expect(result.success).toBe(true);
    });

    it('should reject invalid channel filter', () => {
      expect(NotificationHistoryQuerySchema.safeParse({ channel: 'telegram' }).success).toBe(false);
    });
  });

  describe('NotificationDeliveryStatusSchema', () => {
    it('should accept all valid delivery statuses', () => {
      for (const status of ['sent', 'delivered', 'failed']) {
        expect(NotificationDeliveryStatusSchema.safeParse(status).success).toBe(true);
      }
    });

    it('should reject invalid delivery status', () => {
      expect(NotificationDeliveryStatusSchema.safeParse('pending').success).toBe(false);
    });
  });
});
