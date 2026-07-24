import {
  PaymentController,
  DebtController,
  WebhookController,
} from './payment.controller';
import { InterServiceApiKeyGuard } from '@shared/security';

/**
 * Payment controllers are thin delegates — these tests verify each forwards to
 * the PaymentService and returns its result. Input validation lives in the
 * service (see payment.service.spec.ts).
 */
describe('Payment Controllers', () => {
  const TEST_USER_ID = 'USR-SESSION-001';

  // ═══════════════════════════════════════════════════════════════════════════
  // PaymentController — /payments
  // ═══════════════════════════════════════════════════════════════════════════

  describe('PaymentController', () => {
    let controller: PaymentController;
    let service: Record<string, jest.Mock>;

    const mockPaymentResponse = {
      paymentId: 'PAY-2026-001',
      invoiceId: 'INV-2026-001',
      amount: 123273,
      method: 'qr_code',
      qrCodeUrl: 'https://pay.ioc.local/qr/PAY-2026-001',
      paymentLink: null,
      status: 'pending',
      expiresAt: '2026-06-09T10:00:00Z',
      createdAt: '2026-06-09T09:00:00Z',
    };
    const mockHistoryResponse = {
      payments: [],
      totalCount: 0,
      page: 1,
      limit: 10,
      totalPages: 0,
    };
    const mockBatchResponse = {
      paymentId: 'PAY-2026-BATCH-001',
      invoiceIds: ['INV-2026-001', 'INV-2026-002'],
      totalAmount: 182003,
      method: 'qr_code',
      qrCodeUrl: 'https://pay.ioc.local/qr/PAY-2026-BATCH-001',
      paymentLink: null,
      status: 'pending',
      expiresAt: '2026-06-09T11:00:00Z',
      createdAt: '2026-06-09T10:00:00Z',
    };
    const mockAutoDebitResponse = {
      registrationId: 'AD-2026-001',
      status: 'pending_verification',
      registeredAt: '2026-06-09T10:30:00Z',
    };

    beforeEach(() => {
      service = {
        createPayment: jest.fn(),
        getPaymentHistory: jest.fn(),
        createBatchPayment: jest.fn(),
        setupAutoDebit: jest.fn(),
      };
      controller = new PaymentController(service as any);
    });

    it('createPayment delegates to service with userId + body', async () => {
      service.createPayment.mockResolvedValue(mockPaymentResponse);
      const result = await controller.createPayment(TEST_USER_ID, {
        invoiceId: 'INV-2026-001',
        method: 'qr_code',
      });
      expect(service.createPayment).toHaveBeenCalledWith(TEST_USER_ID, {
        invoiceId: 'INV-2026-001',
        method: 'qr_code',
      });
      expect(result).toEqual(mockPaymentResponse);
    });

    it('getPaymentHistory delegates to service with userId + query', async () => {
      service.getPaymentHistory.mockResolvedValue(mockHistoryResponse);
      const result = await controller.getPaymentHistory(TEST_USER_ID, {
        page: '1',
        limit: '10',
      });
      expect(service.getPaymentHistory).toHaveBeenCalledWith(TEST_USER_ID, {
        page: '1',
        limit: '10',
      });
      expect(result).toEqual(mockHistoryResponse);
    });

    it('createBatchPayment delegates to service with userId + body', async () => {
      service.createBatchPayment.mockResolvedValue(mockBatchResponse);
      const result = await controller.createBatchPayment(TEST_USER_ID, {
        invoiceIds: ['INV-2026-001', 'INV-2026-002'],
        method: 'qr_code',
      });
      expect(service.createBatchPayment).toHaveBeenCalledWith(TEST_USER_ID, {
        invoiceIds: ['INV-2026-001', 'INV-2026-002'],
        method: 'qr_code',
      });
      expect(result).toEqual(mockBatchResponse);
    });

    it('setupAutoDebit delegates to service with userId + body', async () => {
      service.setupAutoDebit.mockResolvedValue(mockAutoDebitResponse);
      const result = await controller.setupAutoDebit(TEST_USER_ID, {
        bankAccount: { bankName: 'VCB', accountNumber: '1234567890', accountHolder: 'Test' },
      });
      expect(service.setupAutoDebit).toHaveBeenCalledWith(TEST_USER_ID, {
        bankAccount: { bankName: 'VCB', accountNumber: '1234567890', accountHolder: 'Test' },
      });
      expect(result).toEqual(mockAutoDebitResponse);
    });

    it('uses ApiBearerAuth(JWT-auth) for Swagger documentation', () => {
      const metadata = Reflect.getMetadata('swagger/apiSecurity', PaymentController);
      expect(metadata).toBeDefined();
      expect(metadata).toEqual(
        expect.arrayContaining([expect.objectContaining({ 'JWT-auth': expect.any(Array) })]),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DebtController — /payments/debt
  // ═══════════════════════════════════════════════════════════════════════════

  describe('DebtController', () => {
    let controller: DebtController;
    let service: Record<string, jest.Mock>;

    const mockDebtResponse = {
      totalAmount: 852456,
      agingBreakdown: { current: 1, '31-60': 2, '61-90': 3, '>90': 4 },
      debts: [],
      totalCount: 0,
    };
    const mockHistoryResponse = { entries: [], totalCount: 0 };

    beforeEach(() => {
      service = {
        getOutstandingDebt: jest.fn(),
        getDebtHistory: jest.fn(),
      };
      controller = new DebtController(service as any);
    });

    it('getOutstandingDebt delegates to service with userId', async () => {
      service.getOutstandingDebt.mockResolvedValue(mockDebtResponse);
      const result = await controller.getOutstandingDebt(TEST_USER_ID);
      expect(service.getOutstandingDebt).toHaveBeenCalledWith(TEST_USER_ID);
      expect(result).toEqual(mockDebtResponse);
    });

    it('getDebtHistory delegates to service with userId', async () => {
      service.getDebtHistory.mockResolvedValue(mockHistoryResponse);
      const result = await controller.getDebtHistory(TEST_USER_ID);
      expect(service.getDebtHistory).toHaveBeenCalledWith(TEST_USER_ID);
      expect(result).toEqual(mockHistoryResponse);
    });

    it('uses ApiBearerAuth(JWT-auth) for Swagger documentation', () => {
      const metadata = Reflect.getMetadata('swagger/apiSecurity', DebtController);
      expect(metadata).toBeDefined();
      expect(metadata).toEqual(
        expect.arrayContaining([expect.objectContaining({ 'JWT-auth': expect.any(Array) })]),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // WebhookController — /webhooks/payment
  // ═══════════════════════════════════════════════════════════════════════════

  describe('WebhookController', () => {
    let controller: WebhookController;
    let service: Record<string, jest.Mock>;

    const validPayload = {
      paymentId: 'PAY-2026-001',
      invoiceId: 'INV-2026-001',
      customerId: 'USR-001',
      amount: 123273,
      status: 'success',
      timestamp: '2026-06-09T10:00:00Z',
    };

    beforeEach(() => {
      service = { handleWebhook: jest.fn().mockResolvedValue({ processed: true }) };
      controller = new WebhookController(service as any);
    });

    it('handlePaymentIpn delegates to service.handleWebhook and acknowledges', async () => {
      const result = await controller.handlePaymentIpn(validPayload);
      expect(service.handleWebhook).toHaveBeenCalledWith(validPayload);
      expect(result).toEqual({ received: true });
    });

    it('accepts failed status payload', async () => {
      const result = await controller.handlePaymentIpn({ ...validPayload, status: 'failed' });
      expect(service.handleWebhook).toHaveBeenCalledWith({ ...validPayload, status: 'failed' });
      expect(result).toEqual({ received: true });
    });

    it('has @UseGuards(InterServiceApiKeyGuard) decorator', () => {
      const guards = Reflect.getMetadata('__guards__', WebhookController);
      expect(guards).toBeDefined();
      expect(guards.some((g: any) => g === InterServiceApiKeyGuard)).toBe(true);
    });
  });
});
