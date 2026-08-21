import { SupportService } from './support.service';
import { ValidationException } from '@core/common';
import { PortFallbackException } from '@shared/port/port-exceptions';

describe('SupportService', () => {
  let service: SupportService;
  let portRegistry: { execute: jest.Mock };
  let db: { insert: jest.Mock; select: jest.Mock; update: jest.Mock };
  let forwarder: { flushOnce: jest.Mock };

  const TEST_USER_ID = 'USR-SESSION-001';

  /** Drizzle select() builder stub — .from().where().orderBy() trả rows. */
  function stubSelectRows(rows: unknown[]) {
    const builder = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockResolvedValue(rows),
    };
    db.select.mockReturnValue(builder);
    return builder;
  }

  beforeEach(() => {
    portRegistry = { execute: jest.fn() };
    db = {
      insert: jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) }),
      select: jest.fn(),
      update: jest.fn(),
    };
    forwarder = { flushOnce: jest.fn().mockResolvedValue(0) };
    service = new SupportService(portRegistry as any, forwarder as any, db as any);
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

  describe('sendMessage (store-and-forward)', () => {
    it('persist-first vào outbox, trả sent:true NGAY — KHÔNG chờ wire (dù port throw)', async () => {
      // Wire chết: registry throw PortFallbackException. Store-and-forward vẫn nhận.
      portRegistry.execute.mockRejectedValue(
        new PortFallbackException('cskh-chat', new Error('unreachable')),
      );

      const result = await service.sendMessage(TEST_USER_ID, 'xin chào');

      expect(result.sent).toBe(true);
      expect(result.messageId).toEqual(expect.any(String));
      expect(db.insert).toHaveBeenCalledTimes(1);
    });

    it('kích hoạt best-effort flush ngay sau khi lưu (không chặn response)', async () => {
      portRegistry.execute.mockRejectedValue(new Error('unreachable'));
      await service.sendMessage(TEST_USER_ID, 'hi');
      expect(forwarder.flushOnce).toHaveBeenCalled();
    });

    it('flush lỗi cũng không ảnh hưởng response (fire-and-forget)', async () => {
      forwarder.flushOnce.mockRejectedValue(new Error('ticker boom'));
      const result = await service.sendMessage(TEST_USER_ID, 'hi');
      expect(result.sent).toBe(true);
    });

    it('rethrows validation error khi text rỗng — KHÔNG lưu outbox', async () => {
      await expect(service.sendMessage(TEST_USER_ID, '')).rejects.toThrow(ValidationException);
      expect(db.insert).not.toHaveBeenCalled();
    });
  });

  describe('getConversation (merge outbox + server thread)', () => {
    it('gộp pending outbox rows vào thread khi omnichannel chưa echo (wire chết)', async () => {
      portRegistry.execute.mockResolvedValue({ data: { conversationId: 'c1', messages: [] } });
      stubSelectRows([
        {
          messageId: 'uuid-1',
          userId: TEST_USER_ID,
          text: 'tin chưa đẩy được',
          createdAt: new Date('2026-08-19T04:00:00Z'),
          forwardedAt: null,
        },
      ]);

      const result = await service.getConversation(TEST_USER_ID);

      expect(result.conversationId).toBe('c1');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({
        id: 'uuid-1',
        content: 'tin chưa đẩy được',
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        createdAt: '2026-08-19T04:00:00.000Z',
      });
    });

    it('dedup theo messageId: row đã echo trong server thread KHÔNG nhân đôi', async () => {
      portRegistry.execute.mockResolvedValue({
        data: {
          conversationId: 'c1',
          messages: [
            {
              id: 'uuid-1',
              content: 'tin đã đẩy',
              direction: 'INBOUND',
              senderType: 'CUSTOMER',
              createdAt: '2026-08-19T04:00:00Z',
            },
          ],
        },
      });
      stubSelectRows([
        {
          messageId: 'uuid-1',
          userId: TEST_USER_ID,
          text: 'tin đã đẩy',
          createdAt: new Date('2026-08-19T04:00:00Z'),
          forwardedAt: new Date(),
        },
      ]);

      const result = await service.getConversation(TEST_USER_ID);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].id).toBe('uuid-1');
    });

    it('fallback shape khi data null: empty thread', async () => {
      portRegistry.execute.mockResolvedValue({ data: null });
      stubSelectRows([]);
      expect(await service.getConversation(TEST_USER_ID)).toEqual({
        conversationId: null,
        messages: [],
      });
    });

    it('sắp xếp theo createdAt tăng dần (FE dùng inverted list)', async () => {
      portRegistry.execute.mockResolvedValue({
        data: {
          conversationId: 'c1',
          messages: [
            {
              id: 'srv-2',
              content: 'reply nhân viên',
              direction: 'OUTBOUND',
              senderType: 'AGENT',
              createdAt: '2026-08-19T05:00:00Z',
            },
          ],
        },
      });
      stubSelectRows([
        {
          messageId: 'uuid-1',
          userId: TEST_USER_ID,
          text: 'tin của tôi',
          createdAt: new Date('2026-08-19T04:00:00Z'),
          forwardedAt: new Date(),
        },
      ]);

      const result = await service.getConversation(TEST_USER_ID);
      expect(result.messages.map((m) => m.id)).toEqual(['uuid-1', 'srv-2']);
    });
  });
});
