/**
 * Integration Test — Payment Webhook
 *
 * Full flow: PaymentService.handleWebhook → IdempotencyService (backed by
 * in-memory cache) → CacheService.deleteByPattern + notification dispatch via
 * PortRegistry ('notification' / 'dispatch-notification').
 *
 * AC: #2 (cache invalidation), #4 (idempotency), #5 (notification dispatch)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_SERVICE_TOKEN } from '../../src/libs/core/constants/tokens';
import { PortRegistry } from '../../src/libs/shared/port';
import { IdempotencyService } from '../../src/libs/shared/idempotency/idempotency.service';
import { PaymentService } from '../../src/modules/payment/payment.service';

// Working mock cache — stores values in-memory so idempotency can retrieve them
const cacheStore = new Map<string, any>();
const mockCacheService = {
  get: jest.fn((key: string) => Promise.resolve(cacheStore.get(key) ?? null)),
  set: jest.fn((key: string, value: any) => { cacheStore.set(key, value); return Promise.resolve(undefined); }),
  delete: jest.fn((key: string) => { cacheStore.delete(key); return Promise.resolve(undefined); }),
  exists: jest.fn().mockResolvedValue(false),
  clear: jest.fn(() => { cacheStore.clear(); return Promise.resolve(undefined); }),
  mget: jest.fn().mockResolvedValue([]),
  mset: jest.fn().mockResolvedValue(undefined),
  mdelete: jest.fn().mockResolvedValue(undefined),
  incr: jest.fn().mockResolvedValue(1),
  decr: jest.fn().mockResolvedValue(0),
  ttl: jest.fn().mockResolvedValue(-1),
  deleteByPattern: jest.fn().mockResolvedValue(2),
};

// Capture dispatch-notification calls (notification port)
const dispatchCalls: any[] = [];
const mockPortRegistry = {
  execute: jest.fn((port: string, method: string, params: any) => {
    if (port === 'notification' && method === 'dispatch-notification') {
      dispatchCalls.push(params);
    }
    return Promise.resolve({ data: { dispatched: true } });
  }),
};

describe('Payment Webhook Integration', () => {
  let module: TestingModule;
  let paymentService: PaymentService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        PaymentService,
        IdempotencyService,
        { provide: CACHE_SERVICE_TOKEN, useValue: mockCacheService },
        { provide: PortRegistry, useValue: mockPortRegistry },
      ],
    }).compile();

    await module.init();
    paymentService = module.get(PaymentService);
  });

  afterAll(async () => {
    await module.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
    dispatchCalls.length = 0;
  });

  it('should process successful payment webhook end-to-end', async () => {
    const result = await paymentService.handleWebhook({
      paymentId: 'PAY-INT-001',
      invoiceId: 'INV-INT-001',
      customerId: 'USR-INT-001',
      amount: 150000,
      status: 'success',
      timestamp: '2026-06-09T10:00:00Z',
    });

    expect(result.processed).toBe(true);
    expect(result.status).toBe('success');
    expect(mockCacheService.deleteByPattern).toHaveBeenCalledWith('cache:v2:port:invoice:*');

    // Notification dispatched via port
    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0].type).toBe('payment_completed');
    expect(dispatchCalls[0].isCritical).toBe(true);
    expect(dispatchCalls[0].customerId).toBe('USR-INT-001');
  });

  it('should handle duplicate webhook via idempotency', async () => {
    const payload = {
      paymentId: 'PAY-INT-DUP',
      invoiceId: 'INV-INT-DUP',
      customerId: 'USR-INT-DUP',
      amount: 200000,
      status: 'success' as const,
      timestamp: '2026-06-09T10:00:00Z',
    };

    const first = await paymentService.handleWebhook(payload);
    expect(first.processed).toBe(true);

    const second = await paymentService.handleWebhook(payload);
    expect(second.processed).toBe(false);
    expect(second.status).toBe('duplicate');
  });
});
