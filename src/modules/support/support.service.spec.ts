import { SupportService } from './support.service';
import { ValidationException } from '@core/common';
import { PortFallbackException } from '@shared/port/port-exceptions';

describe('SupportService', () => {
  let service: SupportService;
  let portRegistry: { execute: jest.Mock };

  const TEST_USER_ID = 'USR-SESSION-001';

  beforeEach(() => {
    portRegistry = { execute: jest.fn() };
    service = new SupportService(portRegistry as any);
  });

  describe('getCallHistory', () => {
    it('calls call-center/get-call-history and returns data', async () => {
      const data = {
        customerId: TEST_USER_ID,
        calls: [
          {
            callId: 'CALL-1',
            startedAt: '2026-07-06T09:12:00Z',
            durationSec: 184,
            outcome: 'completed',
          },
        ],
      };
      portRegistry.execute.mockResolvedValue({ data });

      const result = await service.getCallHistory(TEST_USER_ID);

      expect(portRegistry.execute).toHaveBeenCalledWith('call-center', 'get-call-history', {
        customerId: TEST_USER_ID,
      });
      expect(result).toEqual(data);
    });

    it('throws PortFallbackException when result.data is null', async () => {
      portRegistry.execute.mockResolvedValue({ data: null });
      await expect(service.getCallHistory(TEST_USER_ID)).rejects.toThrow(PortFallbackException);
    });
  });

  describe('createClickToCall', () => {
    it('validates, calls call-center/create-click-to-call with correct params, returns data', async () => {
      const data = { callId: 'CALL-1', status: 'initiated', phoneNumber: '0912345678' };
      portRegistry.execute.mockResolvedValue({ data });

      const result = await service.createClickToCall(TEST_USER_ID, { phoneNumber: '0912345678' });

      expect(portRegistry.execute).toHaveBeenCalledWith('call-center', 'create-click-to-call', {
        customerId: TEST_USER_ID,
        phoneNumber: '0912345678',
        useCache: false,
      });
      expect(result).toEqual(data);
    });

    it('throws ValidationException for empty phoneNumber', async () => {
      await expect(
        service.createClickToCall(TEST_USER_ID, { phoneNumber: '' }),
      ).rejects.toThrow(ValidationException);
    });

    it('throws ValidationException for missing phoneNumber', async () => {
      await expect(service.createClickToCall(TEST_USER_ID, {})).rejects.toThrow(ValidationException);
    });

    it('throws PortFallbackException when result.data is null', async () => {
      portRegistry.execute.mockResolvedValue({ data: null });
      await expect(
        service.createClickToCall(TEST_USER_ID, { phoneNumber: '0912345678' }),
      ).rejects.toThrow(PortFallbackException);
    });
  });
});
