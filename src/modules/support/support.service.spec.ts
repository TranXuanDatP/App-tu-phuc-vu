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

  describe('sendMessage (cskh-chat wire)', () => {
    it('forwards session userId+text qua port cskh-chat/send-message', async () => {
      portRegistry.execute.mockResolvedValue({
        data: { sent: true, conversationId: 'c1', messageId: 'm1' },
      });

      const result = await service.sendMessage(TEST_USER_ID, 'xin chào');

      expect(portRegistry.execute).toHaveBeenCalledWith('cskh-chat', 'send-message', {
        userId: TEST_USER_ID,
        text: 'xin chào',
      });
      expect(result).toEqual({ sent: true, conversationId: 'c1', messageId: 'm1' });
    });

    it('passes through adapter reason (unauthorized) — auth failure KHÔNG throw lên FE', async () => {
      portRegistry.execute.mockResolvedValue({
        data: { sent: false, reason: 'unauthorized' },
      });

      const result = await service.sendMessage(TEST_USER_ID, 'hi');

      expect(result).toEqual({ sent: false, reason: 'unauthorized' });
    });

    it('maps PortException (infra: 5xx/timeout qua registry fallback) → {sent:false, reason:"server-error"}', async () => {
      // Registry CB path: adapter throw → executeFallback miss → PortFallbackException
      portRegistry.execute.mockRejectedValue(
        new PortFallbackException('cskh-chat', new Error('HTTP 500')),
      );

      const result = await service.sendMessage(TEST_USER_ID, 'hi');

      expect(result).toEqual({ sent: false, reason: 'server-error' });
    });

    it('rethrows non-port errors (bug không bị nuốt)', async () => {
      portRegistry.execute.mockRejectedValue(new Error('unexpected bug'));
      await expect(service.sendMessage(TEST_USER_ID, 'hi')).rejects.toThrow('unexpected bug');
    });

    it('throws ValidationException khi text rỗng', async () => {
      await expect(service.sendMessage(TEST_USER_ID, '')).rejects.toThrow(ValidationException);
    });
  });

  describe('getConversation (cskh-chat wire)', () => {
    it('forwards userId qua port cskh-chat/get-conversation và trả thread', async () => {
      portRegistry.execute.mockResolvedValue({
        data: { conversationId: 'c1', messages: [] },
      });

      const result = await service.getConversation(TEST_USER_ID);

      expect(portRegistry.execute).toHaveBeenCalledWith('cskh-chat', 'get-conversation', {
        userId: TEST_USER_ID,
      });
      expect(result).toEqual({ conversationId: 'c1', messages: [] });
    });

    it('fallback shape khi data null: empty thread', async () => {
      portRegistry.execute.mockResolvedValue({ data: null });
      expect(await service.getConversation(TEST_USER_ID)).toEqual({
        conversationId: null,
        messages: [],
      });
    });
  });
});
