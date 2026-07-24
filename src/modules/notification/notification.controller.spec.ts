import { NotificationController, ProactiveNotificationController } from './notification.controller';

/**
 * Controllers are thin delegates — these tests verify they forward to the
 * service and return its result. Input validation lives in the service
 * (see notification.service.spec.ts).
 */
describe('NotificationController', () => {
  let controller: NotificationController;
  let service: Record<string, jest.Mock>;

  const TEST_USER_ID = 'USR-SESSION-001';

  beforeEach(() => {
    service = {
      getPreferences: jest.fn(),
      updatePreferences: jest.fn(),
      getHistory: jest.fn(),
      getCutoffSchedule: jest.fn(),
    };
    controller = new NotificationController(service as any);
  });

  it('getPreferences delegates to service with userId', async () => {
    const prefs = {
      customerId: TEST_USER_ID,
      channels: [{ channel: 'push', enabled: true, isCritical: true }],
      updatedAt: '2026-06-11T10:30:00Z',
    };
    service.getPreferences.mockResolvedValue(prefs);
    const result = await controller.getPreferences(TEST_USER_ID);
    expect(service.getPreferences).toHaveBeenCalledWith(TEST_USER_ID);
    expect(result).toEqual(prefs);
  });

  it('updatePreferences delegates userId + body to service', async () => {
    const body = { channels: [{ channel: 'push', enabled: true }] };
    service.updatePreferences.mockResolvedValue({ updatedAt: '2026-06-11T10:35:00Z' });
    await controller.updatePreferences(TEST_USER_ID, body);
    expect(service.updatePreferences).toHaveBeenCalledWith(TEST_USER_ID, body);
  });

  it('getHistory delegates userId + query to service', async () => {
    const history = { notifications: [], totalCount: 0, page: 1, pageSize: 20 };
    service.getHistory.mockResolvedValue(history);
    const result = await controller.getHistory(TEST_USER_ID, { page: '2' });
    expect(service.getHistory).toHaveBeenCalledWith(TEST_USER_ID, { page: '2' });
    expect(result).toEqual(history);
  });

  it('getCutoffSchedule delegates areaId to service', async () => {
    const schedule = { areaId: 'AREA-1', schedules: [] };
    service.getCutoffSchedule.mockResolvedValue(schedule);
    const result = await controller.getCutoffSchedule('AREA-1');
    expect(service.getCutoffSchedule).toHaveBeenCalledWith('AREA-1');
    expect(result).toEqual(schedule);
  });

  it('uses ApiBearerAuth for Swagger documentation', () => {
    const metadata = Reflect.getMetadata('swagger/apiSecurity', NotificationController);
    expect(metadata).toBeDefined();
    expect(metadata).toEqual(
      expect.arrayContaining([expect.objectContaining({ 'JWT-auth': expect.any(Array) })]),
    );
  });
});

describe('ProactiveNotificationController', () => {
  let controller: ProactiveNotificationController;
  let service: Record<string, jest.Mock>;

  const TEST_USER_ID = 'USR-SESSION-001';

  beforeEach(() => {
    service = {
      getActiveAlerts: jest.fn(),
      getAlertHistory: jest.fn(),
      acknowledgeAlert: jest.fn(),
    };
    controller = new ProactiveNotificationController(service as any);
  });

  it('getActiveAlerts delegates to service with userId', async () => {
    const alerts = { alerts: [], totalCount: 0 };
    service.getActiveAlerts.mockResolvedValue(alerts);
    const result = await controller.getActiveAlerts(TEST_USER_ID);
    expect(service.getActiveAlerts).toHaveBeenCalledWith(TEST_USER_ID);
    expect(result).toEqual(alerts);
  });

  it('getAlertHistory delegates userId + query to service', async () => {
    const history = { alerts: [], totalCount: 0, page: 1, pageSize: 20 };
    service.getAlertHistory.mockResolvedValue(history);
    await controller.getAlertHistory(TEST_USER_ID, { startDate: '2026-01-01' });
    expect(service.getAlertHistory).toHaveBeenCalledWith(TEST_USER_ID, { startDate: '2026-01-01' });
  });

  it('acknowledgeAlert delegates alertId + userId to service', async () => {
    const ack = {
      alertId: 'ALERT-001',
      customerId: TEST_USER_ID,
      acknowledgedAt: '2026-06-10T14:30:00+07:00',
    };
    service.acknowledgeAlert.mockResolvedValue(ack);
    const result = await controller.acknowledgeAlert(TEST_USER_ID, { alertId: 'ALERT-001' });
    expect(service.acknowledgeAlert).toHaveBeenCalledWith('ALERT-001', TEST_USER_ID);
    expect(result).toEqual(ack);
  });

  it('uses ApiBearerAuth for Swagger documentation', () => {
    const metadata = Reflect.getMetadata('swagger/apiSecurity', ProactiveNotificationController);
    expect(metadata).toBeDefined();
    expect(metadata).toEqual(
      expect.arrayContaining([expect.objectContaining({ 'JWT-auth': expect.any(Array) })]),
    );
  });
});
