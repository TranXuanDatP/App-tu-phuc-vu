/**
 * Integration Test — Payment History
 *
 * Full flow: PaymentService.getPaymentHistory → PortRegistry → MockPaymentAdapter
 * → JSON. Tests the payment history read with pagination.
 *
 * AC: #1 (payment history), #3 (no cache — transaction tier)
 */

import { EndpointConfigService } from '../../src/libs/shared/endpoint-config/endpoint-config.service';
import { StructuredLogger } from '../../src/libs/shared/observability/structured-logger.service';
import { FallbackProvider } from '../../src/libs/shared/resilience/fallback.provider';
import { PortRegistry } from '../../src/libs/shared/port/port-registry.service';
import { CACHE_SERVICE_TOKEN } from '../../src/libs/core/constants/tokens';
import { MockPaymentAdapter } from '../../src/modules/payment/clients/payment.client';
import { PaymentService } from '../../src/modules/payment/payment.service';

const mockCacheService = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  delete: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn().mockResolvedValue(false),
  clear: jest.fn().mockResolvedValue(undefined),
  mget: jest.fn().mockResolvedValue([]),
  mset: jest.fn().mockResolvedValue(undefined),
  mdelete: jest.fn().mockResolvedValue(undefined),
  incr: jest.fn().mockResolvedValue(1),
  decr: jest.fn().mockResolvedValue(0),
  ttl: jest.fn().mockResolvedValue(-1),
  deleteByPattern: jest.fn().mockResolvedValue(0),
};

describe('Payment History Integration', () => {
  let paymentService: PaymentService;
  let configService: EndpointConfigService;
  let originalBackendsUrl: string | undefined;

  beforeAll(async () => {
    originalBackendsUrl = process.env.BACKEND_BASE_URL;
    process.env.BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || 'http://localhost:8080';

    const structuredLogger = new StructuredLogger();
    configService = new EndpointConfigService(structuredLogger);
    await configService.onModuleInit();

    const fallbackProvider = new FallbackProvider(structuredLogger);

    const portRegistry = new PortRegistry(
      configService,
      mockCacheService as any,
      fallbackProvider,
      structuredLogger,
      { current: () => ({ correlationId: 'integration-test' }) } as any,
    );

    const mockPaymentAdapter = new MockPaymentAdapter();
    portRegistry.register('payment', mockPaymentAdapter, mockPaymentAdapter);

    paymentService = new PaymentService(
      portRegistry as any,
      mockCacheService as any,
      { getExisting: jest.fn().mockResolvedValue(null), store: jest.fn().mockResolvedValue(undefined) } as any,
      { execute: jest.fn().mockResolvedValue(undefined) } as any,
    );
  });

  afterAll(async () => {
    await configService.onModuleDestroy();
    if (originalBackendsUrl === undefined) {
      delete process.env.BACKEND_BASE_URL;
    } else {
      process.env.BACKEND_BASE_URL = originalBackendsUrl;
    }
  });

  // ── AC#1: Payment History — Service → PortRegistry → MockAdapter → JSON

  describe('GET /payments/history — Service → PortRegistry → MockAdapter → JSON', () => {
    it('should return paginated payment history end-to-end', async () => {
      const result = await paymentService.getPaymentHistory('USR-001', { page: 1, limit: 10 });

      expect(result).toBeDefined();
      expect(result.payments).toBeInstanceOf(Array);
      expect(result.payments.length).toBeGreaterThan(0);
      expect(result.totalCount).toBeGreaterThan(0);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.totalPages).toBeGreaterThan(0);
    });

    it('should return items with valid payment history shape', async () => {
      const result = await paymentService.getPaymentHistory('USR-001', { page: 1, limit: 10 });

      const item = result.payments[0];
      expect(item.paymentId).toBeDefined();
      expect(item.invoiceIds).toBeInstanceOf(Array);
      expect(item.amount).toBeGreaterThanOrEqual(0);
      expect(item.method).toBeDefined();
      expect(item.status).toBeDefined();
      expect(item.createdAt).toBeDefined();
    });
  });
});
