/**
 * Payment Contract Tests — lock the response shape + unique paymentId.
 *
 * Uses real mock adapters (MockPaymentAdapter with counter override) via PortRegistry
 * to verify: (1) create payment shape, (2) unique paymentId per call.
 * Pattern matches test/integration/payment.spec.ts.
 */
import { EndpointConfigService } from '../../src/libs/shared/endpoint-config/endpoint-config.service';
import { StructuredLogger } from '../../src/libs/shared/observability/structured-logger.service';
import { FallbackProvider } from '../../src/libs/shared/resilience/fallback.provider';
import { PortRegistry } from '../../src/libs/shared/port/port-registry.service';
import { MockPaymentAdapter } from '../../src/modules/payment/clients/payment.client';
import { MockInvoiceAdapter } from '../../src/modules/billing/clients/invoice.client';
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

describe('Payment Contract Tests', () => {
  let paymentService: PaymentService;
  let portRegistry: PortRegistry;

  beforeAll(async () => {
    process.env.BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || 'http://localhost:8080';

    const structuredLogger = new StructuredLogger();
    const configService = new EndpointConfigService(structuredLogger);
    await configService.onModuleInit();
    const fallbackProvider = new FallbackProvider(structuredLogger);

    portRegistry = new PortRegistry(
      configService,
      mockCacheService as any,
      fallbackProvider,
      structuredLogger,
      { current: () => ({ correlationId: 'contract-test' }) } as any,
    );

    const mockInvoice = new MockInvoiceAdapter();
    portRegistry.register('invoice', mockInvoice, mockInvoice);
    const mockPayment = new MockPaymentAdapter();
    portRegistry.register('payment', mockPayment, mockPayment);

    paymentService = new PaymentService(
      portRegistry as any,
      mockCacheService as any,
      { getExisting: jest.fn().mockResolvedValue(null), store: jest.fn().mockResolvedValue(undefined) } as any,
    );
  });

  afterAll(async () => {});

  describe('createPayment — contract shape', () => {
    it('should return {paymentId, invoiceId, amount, method, status, expiresAt, createdAt}', async () => {
      // QN-0912345 owns INV-2026-001 — bound customer paying their own invoice (A2).
      const result = await paymentService.createPayment('QN-0912345', {
        invoiceId: 'INV-2026-001',
        method: 'qr_code',
      });

      expect(result.paymentId).toMatch(/^PAY-/);
      expect(result.invoiceId).toBe('INV-2026-001');
      expect(typeof result.amount).toBe('number');
      expect(result.method).toBe('qr_code');
      expect(['pending', 'processing', 'completed', 'failed']).toContain(result.status);
      expect(result.expiresAt).toBeDefined();
      expect(result.createdAt).toBeDefined();
    });
  });

  describe('createPayment — unique paymentId per call', () => {
    it('should generate different paymentIds for multiple calls', async () => {
      const ids = new Set<string>();
      for (let i = 0; i < 3; i++) {
        const result = await paymentService.createPayment('QN-0912345', {
          invoiceId: 'INV-2026-001',
          method: 'bank_transfer',
        });
        ids.add(result.paymentId);
      }
      expect(ids.size).toBe(3);
    });
  });
});
