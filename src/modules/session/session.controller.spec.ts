import { SessionController } from './session.controller';

/**
 * SessionController is a thin delegate — these tests verify it forwards to the
 * service and returns its result. Validation lives in the service
 * (see session.service.spec.ts).
 */
describe('SessionController', () => {
  let controller: SessionController;
  let service: {
    getMySession: jest.Mock;
    getMyEvents: jest.Mock;
  };

  const TEST_USER_ID = 'USR-SESSION-001';

  beforeEach(() => {
    service = {
      getMySession: jest.fn(),
      getMyEvents: jest.fn(),
    };
    controller = new SessionController(service as any);
  });

  describe('getMySession', () => {
    it('delegates to service with userId', async () => {
      const detail = { session: { userId: TEST_USER_ID }, recentEvents: [] };
      service.getMySession.mockResolvedValue(detail);

      const result = await controller.getMySession(TEST_USER_ID);

      expect(service.getMySession).toHaveBeenCalledWith(TEST_USER_ID);
      expect(result).toEqual(detail);
    });
  });

  describe('getMyEvents', () => {
    it('delegates to service with userId and raw query', async () => {
      const response = {
        events: [],
        totalCount: 0,
        page: 1,
        pageSize: 20,
        sessionId: null,
      };
      service.getMyEvents.mockResolvedValue(response);

      const result = await controller.getMyEvents(TEST_USER_ID, {
        page: '1',
        pageSize: '10',
      });

      expect(service.getMyEvents).toHaveBeenCalledWith(TEST_USER_ID, {
        page: '1',
        pageSize: '10',
      });
      expect(result).toEqual(response);
    });

    it('forwards empty query unchanged', async () => {
      service.getMyEvents.mockResolvedValue({
        events: [],
        totalCount: 0,
        page: 1,
        pageSize: 20,
        sessionId: null,
      });

      await controller.getMyEvents(TEST_USER_ID, {});

      expect(service.getMyEvents).toHaveBeenCalledWith(TEST_USER_ID, {});
    });
  });
});
