import { SupportController } from './support.controller';

/**
 * SupportController is a thin delegate — these tests verify it forwards to the
 * service and returns its result. Input validation lives in the service
 * (see support.service.spec.ts).
 */
describe('SupportController', () => {
  let controller: SupportController;
  let service: {
    getCallHistory: jest.Mock;
    createClickToCall: jest.Mock;
  };

  const TEST_USER_ID = 'USR-SESSION-001';
  const mockClickToCall = {
    callId: 'CALL-1',
    status: 'initiated',
    phoneNumber: '0912345678',
  };
  const mockHistory = { customerId: TEST_USER_ID, calls: [] };

  beforeEach(() => {
    service = {
      getCallHistory: jest.fn(),
      createClickToCall: jest.fn(),
    };
    controller = new SupportController(service as any);
  });

  it('history delegates to service with userId', async () => {
    service.getCallHistory.mockResolvedValue(mockHistory);
    const result = await controller.history(TEST_USER_ID);
    expect(service.getCallHistory).toHaveBeenCalledWith(TEST_USER_ID);
    expect(result).toEqual(mockHistory);
  });

  it('clickToCall delegates body to service', async () => {
    service.createClickToCall.mockResolvedValue(mockClickToCall);
    const result = await controller.clickToCall(TEST_USER_ID, { phoneNumber: '0912345678' });
    expect(service.createClickToCall).toHaveBeenCalledWith(TEST_USER_ID, { phoneNumber: '0912345678' });
    expect(result).toEqual(mockClickToCall);
  });
});
