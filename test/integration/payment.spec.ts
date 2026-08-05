/**
 * Integration Test — Payment Module
 *
 * Full flow: PaymentService.createPayment → PortRegistry → MockAdapters → JSON.
 * Tests the sequential orchestration: verify invoice → create payment.
 *
 * AC: #1 (create payment), #2 (no cache), #4 (idempotency via PortRegistry)
 */

import { EndpointConfigService } from '../../src/libs/shared/endpoint-config/endpoint-config.service';
import { StructuredLogger } from '../../src/libs/shared/observability/structured-logger.service';
import { FallbackProvider } from '../../src/libs/shared/resilience/fallback.provider';
import { PortRegistry } from '../../src/libs/shared/port/port-registry.service';
import { CACHE_SERVICE_TOKEN } from '../../src/libs/core/constants/tokens';
import { MockPaymentAdapter } from '../../src/modules/payment/clients/payment.client';
import { MockInvoiceAdapter } from '../../src/modules/billing/clients/invoice.client';
import { PaymentService } from '../../src/modules/payment/payment.service';
import { IPortAdapter } from '../../src/libs/shared/port/port.interface';

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

describe('Payment Integration', () => {
  let paymentService: PaymentService;
  let configService: EndpointConfigService;
  let portRegistry: PortRegistry;
  let originalBackendsUrl: string | undefined;

  beforeAll(async () => {
    originalBackendsUrl = process.env.BACKEND_BASE_URL;
    process.env.BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || 'http://localhost:8080';

    const structuredLogger = new StructuredLogger();
    configService = new EndpointConfigService(structuredLogger);
    await configService.onModuleInit();

    const fallbackProvider = new FallbackProvider(structuredLogger);

    portRegistry = new PortRegistry(
      configService,
      mockCacheService as any,
      fallbackProvider,
      structuredLogger,
      { current: () => ({ correlationId: 'integration-test' }) } as any,
    );

    // Register both invoice and payment ports
    const mockInvoiceAdapter = new MockInvoiceAdapter();
    portRegistry.register('invoice', mockInvoiceAdapter, mockInvoiceAdapter);

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

  // ── AC#1: Create Payment — Sequential Orchestration ────────────────────────

  describe('POST /payments — Service → PortRegistry → MockAdapter → JSON', () => {
    it('should verify unpaid invoice and create payment end-to-end', async () => {
      // QN-0912345 owns INV-2026-001 (mocks/invoice/get-list.json) — the bound customer
      // paying their OWN invoice (A2 Layer-2 ownership).
      const result = await paymentService.createPayment('QN-0912345', {
        invoiceId: 'INV-2026-001',
        method: 'qr_code',
      });

      expect(result).toBeDefined();
      expect(result.paymentId).toBeDefined();
      expect(result.invoiceId).toBe('INV-2026-001');
      expect(result.amount).toBeGreaterThan(0);
      expect(result.method).toBe('qr_code');
      expect(result.status).toBeDefined();
      expect(result.expiresAt).toBeDefined();

      // Verify QR code URL is valid
      if (result.qrCodeUrl) {
        expect(result.qrCodeUrl).toMatch(/^https?:\/\//);
      }
    });

    it('should return payment with valid response shape', async () => {
      // QN-0912345 owns INV-2026-001 (mocks/invoice/get-list.json) — the bound customer
      // paying their OWN invoice (A2 Layer-2 ownership).
      const result = await paymentService.createPayment('QN-0912345', {
        invoiceId: 'INV-2026-001',
        method: 'qr_code',
      });

      expect(result).toHaveProperty('paymentId');
      expect(result).toHaveProperty('invoiceId');
      expect(result).toHaveProperty('amount');
      expect(result).toHaveProperty('method');
      expect(result).toHaveProperty('qrCodeUrl');
      expect(result).toHaveProperty('paymentLink');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('expiresAt');
      expect(result).toHaveProperty('createdAt');
    });
  });

  // ── AC#1: Invoice status guard — paid invoice rejection ──────────────────────

  describe('invoice status guard — paid invoice', () => {
    it('should reject payment when invoice is already paid', async () => {
      // Create a custom invoice adapter that returns a paid invoice for a specific ID
      const paidInvoiceAdapter: IPortAdapter = {
        execute: jest.fn().mockImplementation(async (method: string, params: Record<string, unknown>) => {
          if (method === 'get-by-id' && params.invoiceId === 'INV-PAID') {
            return {
              invoiceId: 'INV-PAID',
              contractId: 'CTR-001',
              period: '2026-05',
              lineItems: [{ description: 'Bậc 1', volume: 10, unitPrice: 5973, amount: 59730 }],
              subtotal: 59730,
              fees: [{ feeName: 'VAT', amount: 2987 }],
              totalAmount: 62717,
              paymentStatus: 'paid',
              cqtCode: 'CQT-001',
              lookupCode: 'LC-001',
              issueDate: '2026-06-01',
              dueDate: '2026-06-15',
            };
          }
          // Fall back to normal mock for other IDs
          const normalAdapter = new MockInvoiceAdapter();
          return normalAdapter.execute(method, params);
        }),
      };

      // Register the paid-invoice adapter
      portRegistry.register('invoice', paidInvoiceAdapter, paidInvoiceAdapter);

      await expect(
        paymentService.createPayment('USR-001', { invoiceId: 'INV-PAID', method: 'qr_code' }),
      ).rejects.toThrow('Current status: paid');

      // Restore original adapter for subsequent tests
      const originalAdapter = new MockInvoiceAdapter();
      portRegistry.register('invoice', originalAdapter, originalAdapter);
    });
  });
});
