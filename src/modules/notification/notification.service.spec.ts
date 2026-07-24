import { NotificationService } from './notification.service';
import { ValidationException } from '@core/common';

describe('NotificationService', () => {
  let service: NotificationService;
  let portRegistry: { execute: jest.Mock };

  const TEST_USER_ID = 'USR-SESSION-001';

  beforeEach(() => {
    portRegistry = { execute: jest.fn() };
    service = new NotificationService(portRegistry as any);
  });

  // ── proactive-notification port ─────────────────────────────────────────────

  describe('getActiveAlerts', () => {
    it('calls proactive-notification/get-active-alerts and returns data', async () => {
      const alerts = { alerts: [], totalCount: 0 };
      portRegistry.execute.mockResolvedValue({ data: alerts });
      const result = await service.getActiveAlerts(TEST_USER_ID);
      expect(portRegistry.execute).toHaveBeenCalledWith(
        'proactive-notification',
        'get-active-alerts',
        { customerId: TEST_USER_ID },
      );
      expect(result).toEqual(alerts);
    });
  });

  describe('getAlertHistory', () => {
    it('calls proactive-notification/get-alert-history with filters', async () => {
      const history = { alerts: [], totalCount: 0, page: 1, pageSize: 20 };
      portRegistry.execute.mockResolvedValue({ data: history });
      const result = await service.getAlertHistory(TEST_USER_ID, {
        startDate: '2026-01-01',
        endDate: '2026-06-10',
      });
      expect(portRegistry.execute).toHaveBeenCalledWith(
        'proactive-notification',
        'get-alert-history',
        expect.objectContaining({ customerId: TEST_USER_ID, startDate: '2026-01-01' }),
      );
      expect(result).toEqual(history);
    });

    it('rejects invalid startDate format', async () => {
      await expect(
        service.getAlertHistory(TEST_USER_ID, { startDate: 'not-a-date' }),
      ).rejects.toThrow(ValidationException);
    });

    it('coerces page/pageSize from string to number', async () => {
      portRegistry.execute.mockResolvedValue({ data: { alerts: [], totalCount: 0, page: 2, pageSize: 10 } });
      await service.getAlertHistory(TEST_USER_ID, { page: '2', pageSize: '10' });
      expect(portRegistry.execute).toHaveBeenCalledWith(
        'proactive-notification',
        'get-alert-history',
        expect.objectContaining({ page: 2, pageSize: 10 }),
      );
    });
  });

  describe('acknowledgeAlert', () => {
    it('calls proactive-notification/acknowledge-alert', async () => {
      const ack = {
        alertId: 'ALERT-001',
        customerId: TEST_USER_ID,
        acknowledgedAt: '2026-06-10T14:30:00+07:00',
      };
      portRegistry.execute.mockResolvedValue({ data: ack });
      const result = await service.acknowledgeAlert('ALERT-001', TEST_USER_ID);
      expect(portRegistry.execute).toHaveBeenCalledWith(
        'proactive-notification',
        'acknowledge-alert',
        { alertId: 'ALERT-001', customerId: TEST_USER_ID, useCache: false },
      );
      expect(result).toEqual(ack);
    });

    it('rejects empty alertId', async () => {
      await expect(service.acknowledgeAlert('', TEST_USER_ID)).rejects.toThrow(ValidationException);
    });

    it('rejects alertId with special characters', async () => {
      await expect(
        service.acknowledgeAlert('ALERT@INVALID!', TEST_USER_ID),
      ).rejects.toThrow(ValidationException);
    });
  });

  // ── notification port ───────────────────────────────────────────────────────

  describe('getPreferences', () => {
    it('calls notification/get-notification-preferences and returns data', async () => {
      const prefs = {
        customerId: TEST_USER_ID,
        channels: [],
        updatedAt: '2026-06-11T10:30:00Z',
      };
      portRegistry.execute.mockResolvedValue({ data: prefs });
      const result = await service.getPreferences(TEST_USER_ID);
      expect(portRegistry.execute).toHaveBeenCalledWith(
        'notification',
        'get-notification-preferences',
        { customerId: TEST_USER_ID },
      );
      expect(result).toEqual(prefs);
    });
  });

  describe('getHistory', () => {
    it('calls notification/get-notification-history with filters', async () => {
      const history = { notifications: [], totalCount: 0, page: 1, pageSize: 20 };
      portRegistry.execute.mockResolvedValue({ data: history });
      const result = await service.getHistory(TEST_USER_ID, { channel: 'push' });
      expect(portRegistry.execute).toHaveBeenCalledWith(
        'notification',
        'get-notification-history',
        expect.objectContaining({ customerId: TEST_USER_ID, channel: 'push' }),
      );
      expect(result).toEqual(history);
    });

    it('coerces page/pageSize from string to number', async () => {
      portRegistry.execute.mockResolvedValue({ data: { notifications: [], totalCount: 0, page: 2, pageSize: 10 } });
      await service.getHistory(TEST_USER_ID, { page: '2', pageSize: '10' });
      expect(portRegistry.execute).toHaveBeenCalledWith(
        'notification',
        'get-notification-history',
        expect.objectContaining({ page: 2, pageSize: 10 }),
      );
    });

    it('rejects pageSize > 50', async () => {
      await expect(
        service.getHistory(TEST_USER_ID, { pageSize: '100' }),
      ).rejects.toThrow(ValidationException);
    });
  });

  describe('updatePreferences', () => {
    it('validates and calls notification/update-notification-preferences', async () => {
      const prefs = {
        customerId: TEST_USER_ID,
        channels: [{ channel: 'push', enabled: true, isCritical: true }],
        updatedAt: '2026-06-11T10:35:00Z',
      };
      portRegistry.execute.mockResolvedValue({ data: prefs });
      const result = await service.updatePreferences(TEST_USER_ID, {
        channels: [{ channel: 'push', enabled: true }],
      });
      expect(portRegistry.execute).toHaveBeenCalledWith(
        'notification',
        'update-notification-preferences',
        {
          customerId: TEST_USER_ID,
          channels: [{ channel: 'push', enabled: true }],
          useCache: false,
        },
      );
      expect(result).toEqual(prefs);
    });

    it('rejects empty channels array', async () => {
      await expect(
        service.updatePreferences(TEST_USER_ID, { channels: [] }),
      ).rejects.toThrow(ValidationException);
    });

    it('rejects invalid channel value', async () => {
      await expect(
        service.updatePreferences(TEST_USER_ID, {
          channels: [{ channel: 'telegram', enabled: true }],
        }),
      ).rejects.toThrow(ValidationException);
    });
  });

  describe('dispatchNotification', () => {
    it('validates and calls notification/dispatch-notification', async () => {
      const res = { dispatched: true, channel: 'push', rateLimited: false };
      portRegistry.execute.mockResolvedValue({ data: res });
      const result = await service.dispatchNotification({
        customerId: TEST_USER_ID,
        type: 'payment_completed',
        isCritical: true,
      });
      expect(portRegistry.execute).toHaveBeenCalledWith(
        'notification',
        'dispatch-notification',
        expect.objectContaining({
          customerId: TEST_USER_ID,
          type: 'payment_completed',
          useCache: false,
        }),
      );
      expect(result).toEqual(res);
    });

    it('rejects invalid notification type', async () => {
      await expect(
        service.dispatchNotification({ customerId: TEST_USER_ID, type: 'nope' }),
      ).rejects.toThrow(ValidationException);
    });
  });

  // ── migrated water-cutoff port ──────────────────────────────────────────────

  describe('getCutoffSchedule', () => {
    it('calls water-cutoff/get-cutoff-schedule and returns data', async () => {
      const schedule = {
        areaId: 'AREA-1',
        schedules: [
          {
            from: '2026-07-15T08:00:00+07:00',
            to: '2026-07-15T12:00:00+07:00',
            reason: 'Bảo trì đường ống',
          },
        ],
      };
      portRegistry.execute.mockResolvedValue({ data: schedule });
      const result = await service.getCutoffSchedule('AREA-1');
      expect(portRegistry.execute).toHaveBeenCalledWith('water-cutoff', 'get-cutoff-schedule', {
        areaId: 'AREA-1',
      });
      expect(result).toEqual(schedule);
    });
  });
});
