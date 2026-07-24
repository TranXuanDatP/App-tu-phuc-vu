import { PaymentService } from './payment.service';
import { ValidationException, ForbiddenException, NotFoundException } from '@core/common';
import { PortFallbackException } from '@shared/port/port-exceptions';
import type { InvoiceDetail } from '@modules/billing/dto/invoice.dto';
import type { PaymentWebhookPayload } from './dto/payment.dto';

/**
 * PaymentService unit tests. The service is the lean BFF orchestrator — these
 * tests verify each method drives PortRegistry with the correct port/method/
 * params (the former CQRS handlers' execute() bodies), applies input validation,
 * and for handleWebhook preserves idempotency + cache invalidation +
 * notification dispatch + session-event recording.
 */
describe('PaymentService', () => {
  let service: PaymentService;
  let portRegistry: { execute: jest.Mock };
  let cacheService: { deleteByPattern: jest.Mock };
  let idempotencyService: { getExisting: jest.Mock; store: jest.Mock };

  const TEST_USER_ID = 'USR-001';

  const makeInvoice = (overrides: Partial<InvoiceDetail> = {}): InvoiceDetail => ({
    invoiceId: 'INV-2026-001',
    contractId: 'CTR-2024-0001',
    period: '2026-05',
    lineItems: [{ description: 'Bậc 1', volume: 10, unitPrice: 5973, amount: 59730 }],
    subtotal: 59730,
    fees: [{ feeName: 'VAT', amount: 2987 }],
    totalAmount: 123273,
    paymentStatus: 'unpaid',
    cqtCode: 'CQT-001',
    lookupCode: 'LC-001',
    issueDate: '2026-06-01',
    dueDate: '2026-06-15',
    ...overrides,
  });

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

  const mockBatchResponse = {
    paymentId: 'PAY-2026-BATCH-001',
    invoiceIds: ['INV-2026-001', 'INV-2026-002'],
    totalAmount: 246546,
    method: 'qr_code',
    qrCodeUrl: 'https://pay.ioc.local/qr/PAY-2026-BATCH-001',
    paymentLink: null,
    status: 'pending',
    expiresAt: '2026-06-09T11:00:00Z',
    createdAt: '2026-06-09T10:00:00Z',
  };

  const mockHistoryResponse = {
    payments: [
      {
        paymentId: 'PAY-2026-001',
        invoiceIds: ['INV-2026-001'],
        amount: 123273,
        method: 'qr_code',
        status: 'completed',
        createdAt: '2026-06-01T10:00:00Z',
      },
    ],
    totalCount: 1,
    page: 1,
    limit: 10,
    totalPages: 1,
  };

  const mockAutoDebitResponse = {
    registrationId: 'AD-2026-001',
    status: 'pending_verification',
    registeredAt: '2026-06-09T10:30:00Z',
  };

  beforeEach(() => {
    portRegistry = { execute: jest.fn() };
    cacheService = { deleteByPattern: jest.fn().mockResolvedValue(3) };
    idempotencyService = {
      getExisting: jest.fn().mockResolvedValue(null),
      store: jest.fn().mockResolvedValue(undefined),
    };
    service = new PaymentService(
      portRegistry as any,
      cacheService as any,
      idempotencyService as any,
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // createPayment
  // ═══════════════════════════════════════════════════════════════════════════

  describe('createPayment', () => {
    it('should verify invoice then create payment', async () => {
      portRegistry.execute
        .mockResolvedValueOnce({ data: makeInvoice(), adapterUsed: 'mock', fromCache: false, duration: 10 })
        .mockResolvedValueOnce({ data: mockPaymentResponse, adapterUsed: 'mock', fromCache: false, duration: 15 });

      const result = await service.createPayment(TEST_USER_ID, {
        invoiceId: 'INV-2026-001',
        method: 'qr_code',
      });

      expect(portRegistry.execute).toHaveBeenNthCalledWith(1, 'invoice', 'get-by-id', {
        invoiceId: 'INV-2026-001',
        customerId: TEST_USER_ID,
        useCache: false,
      });
      expect(portRegistry.execute).toHaveBeenNthCalledWith(2, 'payment', 'create-payment', {
        invoiceId: 'INV-2026-001',
        customerId: TEST_USER_ID,
        method: 'qr_code',
        amount: 123273,
      });
      expect(result.paymentId).toBe('PAY-2026-001');
    });

    it('should throw ForbiddenException when invoice is already paid', async () => {
      portRegistry.execute.mockResolvedValueOnce({
        data: makeInvoice({ paymentStatus: 'paid' }),
        adapterUsed: 'mock', fromCache: false, duration: 10,
      });
      await expect(
        service.createPayment(TEST_USER_ID, { invoiceId: 'INV-2026-001', method: 'qr_code' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should include current status in ForbiddenException message', async () => {
      portRegistry.execute.mockResolvedValueOnce({
        data: makeInvoice({ paymentStatus: 'overdue' }),
        adapterUsed: 'mock', fromCache: false, duration: 10,
      });
      await expect(
        service.createPayment(TEST_USER_ID, { invoiceId: 'INV-2026-001', method: 'qr_code' }),
      ).rejects.toThrow('Current status: overdue');
    });

    it('should NOT call payment port when invoice is already paid', async () => {
      portRegistry.execute.mockResolvedValueOnce({
        data: makeInvoice({ paymentStatus: 'paid' }),
        adapterUsed: 'mock', fromCache: false, duration: 10,
      });
      try {
        await service.createPayment(TEST_USER_ID, { invoiceId: 'INV-2026-001', method: 'qr_code' });
      } catch {
        // expected
      }
      expect(portRegistry.execute).toHaveBeenCalledTimes(1);
    });

    it('should throw NotFoundException when invoice is not found (null data)', async () => {
      portRegistry.execute.mockResolvedValue({ data: null, adapterUsed: 'mock', fromCache: false, duration: 10 });
      await expect(
        service.createPayment(TEST_USER_ID, { invoiceId: 'INV-NOTFOUND', method: 'qr_code' }),
      ).rejects.toThrow('INV-NOTFOUND not found');
    });

    it('should pass useCache: false to invoice lookup', async () => {
      portRegistry.execute
        .mockResolvedValueOnce({ data: makeInvoice(), adapterUsed: 'mock', fromCache: false, duration: 10 })
        .mockResolvedValueOnce({ data: mockPaymentResponse, adapterUsed: 'mock', fromCache: false, duration: 15 });
      await service.createPayment(TEST_USER_ID, { invoiceId: 'INV-2026-001', method: 'qr_code' });
      expect(portRegistry.execute.mock.calls[0][2]).toEqual(
        expect.objectContaining({ useCache: false }),
      );
    });

    it('should throw ValidationException for missing invoiceId', async () => {
      await expect(
        service.createPayment(TEST_USER_ID, { method: 'qr_code' }),
      ).rejects.toThrow(ValidationException);
    });

    it('should throw ValidationException for invalid method', async () => {
      await expect(
        service.createPayment(TEST_USER_ID, { invoiceId: 'INV-001', method: 'crypto' }),
      ).rejects.toThrow(ValidationException);
    });

    it('should accept payment_link method', async () => {
      portRegistry.execute
        .mockResolvedValueOnce({ data: makeInvoice(), adapterUsed: 'mock', fromCache: false, duration: 10 })
        .mockResolvedValueOnce({
          data: { ...mockPaymentResponse, method: 'payment_link', qrCodeUrl: null, paymentLink: 'https://x/link' },
          adapterUsed: 'mock', fromCache: false, duration: 15,
        });
      const result = await service.createPayment(TEST_USER_ID, { invoiceId: 'INV-2026-001', method: 'payment_link' });
      expect(portRegistry.execute.mock.calls[1][2].method).toBe('payment_link');
      expect(result.paymentLink).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getPaymentHistory
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getPaymentHistory', () => {
    it('should call payment/get-payment-history with coerced filters', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockHistoryResponse, adapterUsed: 'mock', fromCache: false, duration: 10 });
      const result = await service.getPaymentHistory(TEST_USER_ID, { page: '1', limit: '10' });
      expect(portRegistry.execute).toHaveBeenCalledWith('payment', 'get-payment-history', {
        customerId: TEST_USER_ID,
        filters: { page: 1, limit: 10 },
      });
      expect(result).toEqual(mockHistoryResponse);
    });

    it('should pass status filter when provided', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockHistoryResponse, adapterUsed: 'mock', fromCache: false, duration: 10 });
      await service.getPaymentHistory(TEST_USER_ID, { page: '1', limit: '10', status: 'completed' });
      expect(portRegistry.execute.mock.calls[0][2].filters.status).toBe('completed');
    });

    it('should apply defaults when page/limit not provided', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockHistoryResponse, adapterUsed: 'mock', fromCache: false, duration: 10 });
      await service.getPaymentHistory(TEST_USER_ID, {});
      const filters = portRegistry.execute.mock.calls[0][2].filters;
      expect(filters.page).toBe(1);
      expect(filters.limit).toBe(10);
    });

    it('should throw NotFoundException when no data returned', async () => {
      portRegistry.execute.mockResolvedValue({ data: null, adapterUsed: 'mock', fromCache: false, duration: 10 });
      await expect(service.getPaymentHistory(TEST_USER_ID, {})).rejects.toThrow(NotFoundException);
    });

    it('should throw ValidationException for negative page', async () => {
      await expect(service.getPaymentHistory(TEST_USER_ID, { page: '-1' })).rejects.toThrow(ValidationException);
    });

    it('should throw ValidationException for limit > 100', async () => {
      await expect(service.getPaymentHistory(TEST_USER_ID, { limit: '101' })).rejects.toThrow(ValidationException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // createBatchPayment
  // ═══════════════════════════════════════════════════════════════════════════

  describe('createBatchPayment', () => {
    it('should verify invoices then create batch payment', async () => {
      const inv1 = makeInvoice({ invoiceId: 'INV-2026-001', totalAmount: 62717 });
      const inv2 = makeInvoice({ invoiceId: 'INV-2026-002', totalAmount: 62717 });
      portRegistry.execute
        .mockResolvedValueOnce({ data: inv1, adapterUsed: 'mock', fromCache: false, duration: 10 })
        .mockResolvedValueOnce({ data: inv2, adapterUsed: 'mock', fromCache: false, duration: 10 })
        .mockResolvedValueOnce({ data: { ...mockBatchResponse, totalAmount: 125434 }, adapterUsed: 'mock', fromCache: false, duration: 15 });

      const result = await service.createBatchPayment(TEST_USER_ID, {
        invoiceIds: ['INV-2026-001', 'INV-2026-002'],
        method: 'qr_code',
      });

      expect(portRegistry.execute).toHaveBeenNthCalledWith(1, 'invoice', 'get-by-id', {
        invoiceId: 'INV-2026-001', customerId: TEST_USER_ID, useCache: false,
      });
      expect(portRegistry.execute).toHaveBeenNthCalledWith(2, 'invoice', 'get-by-id', {
        invoiceId: 'INV-2026-002', customerId: TEST_USER_ID, useCache: false,
      });
      expect(portRegistry.execute).toHaveBeenNthCalledWith(3, 'payment', 'create-batch-payment', {
        invoiceIds: ['INV-2026-001', 'INV-2026-002'],
        customerId: TEST_USER_ID,
        method: 'qr_code',
        totalAmount: 125434,
      });
      expect(result.paymentId).toBe('PAY-2026-BATCH-001');
    });

    it('should accumulate total amount from verified invoices', async () => {
      portRegistry.execute
        .mockResolvedValueOnce({ data: makeInvoice({ totalAmount: 100000 }), adapterUsed: 'mock', fromCache: false, duration: 10 })
        .mockResolvedValueOnce({ data: makeInvoice({ totalAmount: 200000 }), adapterUsed: 'mock', fromCache: false, duration: 10 })
        .mockResolvedValueOnce({ data: { ...mockBatchResponse, totalAmount: 300000 }, adapterUsed: 'mock', fromCache: false, duration: 15 });
      await service.createBatchPayment(TEST_USER_ID, { invoiceIds: ['INV-1', 'INV-2'], method: 'qr_code' });
      expect(portRegistry.execute.mock.calls[2][2].totalAmount).toBe(300000);
    });

    it('should reject entire batch if second invoice is paid', async () => {
      portRegistry.execute
        .mockResolvedValueOnce({ data: makeInvoice({ invoiceId: 'INV-001', totalAmount: 100 }), adapterUsed: 'mock', fromCache: false, duration: 10 })
        .mockResolvedValueOnce({ data: makeInvoice({ invoiceId: 'INV-002', paymentStatus: 'paid', totalAmount: 200 }), adapterUsed: 'mock', fromCache: false, duration: 10 });
      await expect(
        service.createBatchPayment(TEST_USER_ID, { invoiceIds: ['INV-001', 'INV-002'], method: 'qr_code' }),
      ).rejects.toThrow(ForbiddenException);
      expect(portRegistry.execute).toHaveBeenCalledTimes(2); // only invoice lookups
    });

    it('should throw NotFoundException when an invoice is not found', async () => {
      portRegistry.execute.mockResolvedValueOnce({ data: null, adapterUsed: 'mock', fromCache: false, duration: 10 });
      await expect(
        service.createBatchPayment(TEST_USER_ID, { invoiceIds: ['INV-MISSING'], method: 'qr_code' }),
      ).rejects.toThrow('INV-MISSING not found');
    });

    it('should throw ValidationException for empty invoiceIds', async () => {
      await expect(
        service.createBatchPayment(TEST_USER_ID, { invoiceIds: [], method: 'qr_code' }),
      ).rejects.toThrow(ValidationException);
    });

    it('should throw ValidationException for more than 20 invoiceIds', async () => {
      const tooMany = Array.from({ length: 21 }, (_, i) => `INV-${String(i).padStart(3, '0')}`);
      await expect(
        service.createBatchPayment(TEST_USER_ID, { invoiceIds: tooMany, method: 'qr_code' }),
      ).rejects.toThrow(ValidationException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // setupAutoDebit
  // ═══════════════════════════════════════════════════════════════════════════

  describe('setupAutoDebit', () => {
    const validBankAccount = {
      bankName: 'Vietcombank',
      accountNumber: '1234567890',
      accountHolder: 'Nguyen Van A',
    };

    it('should call payment/setup-auto-debit with customerId + bankAccount', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockAutoDebitResponse, adapterUsed: 'mock', fromCache: false, duration: 10 });
      const result = await service.setupAutoDebit(TEST_USER_ID, { bankAccount: validBankAccount });
      expect(portRegistry.execute).toHaveBeenCalledWith('payment', 'setup-auto-debit', {
        customerId: TEST_USER_ID,
        bankAccount: validBankAccount,
      });
      expect(result.registrationId).toBe('AD-2026-001');
    });

    it('should throw NotFoundException when port returns null data', async () => {
      portRegistry.execute.mockResolvedValue({ data: null, adapterUsed: 'mock', fromCache: false, duration: 10 });
      await expect(
        service.setupAutoDebit(TEST_USER_ID, { bankAccount: validBankAccount }),
      ).rejects.toThrow('Auto debit registration failed');
    });

    it('should throw ValidationException for missing bankAccount', async () => {
      await expect(service.setupAutoDebit(TEST_USER_ID, {})).rejects.toThrow(ValidationException);
    });

    it('should throw ValidationException for invalid accountNumber', async () => {
      await expect(
        service.setupAutoDebit(TEST_USER_ID, {
          bankAccount: { bankName: 'VCB', accountNumber: 'ABC', accountHolder: 'Test' },
        }),
      ).rejects.toThrow(ValidationException);
    });

    it('should throw ValidationException for missing bankName', async () => {
      await expect(
        service.setupAutoDebit(TEST_USER_ID, {
          bankAccount: { accountNumber: '1234567890', accountHolder: 'Test' },
        }),
      ).rejects.toThrow(ValidationException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getOutstandingDebt
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getOutstandingDebt', () => {
    const mockDebt = {
      totalAmount: 852456,
      agingBreakdown: { current: 1, '31-60': 2, '61-90': 3, '>90': 4 },
      debts: [],
      totalCount: 0,
    };

    it('should call debt/get-outstanding-debt with customerId', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockDebt, adapterUsed: 'mock', fromCache: false, duration: 10 });
      const result = await service.getOutstandingDebt(TEST_USER_ID);
      expect(portRegistry.execute).toHaveBeenCalledWith('debt', 'get-outstanding-debt', {
        customerId: TEST_USER_ID,
      });
      expect(result.totalAmount).toBe(852456);
    });

    it('should throw PortFallbackException when result.data is null', async () => {
      portRegistry.execute.mockResolvedValue({ data: null, adapterUsed: 'mock', fromCache: false, duration: 10 });
      await expect(service.getOutstandingDebt(TEST_USER_ID)).rejects.toThrow(PortFallbackException);
    });

    it('should throw PortFallbackException when result is undefined', async () => {
      portRegistry.execute.mockResolvedValue(undefined as any);
      await expect(service.getOutstandingDebt(TEST_USER_ID)).rejects.toThrow(PortFallbackException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getDebtHistory
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getDebtHistory', () => {
    const mockHistory = { entries: [], totalCount: 0 };

    it('should call debt/get-debt-history with customerId', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockHistory, adapterUsed: 'mock', fromCache: false, duration: 10 });
      const result = await service.getDebtHistory(TEST_USER_ID);
      expect(portRegistry.execute).toHaveBeenCalledWith('debt', 'get-debt-history', {
        customerId: TEST_USER_ID,
      });
      expect(result).toEqual(mockHistory);
    });

    it('should throw PortFallbackException when result.data is null', async () => {
      portRegistry.execute.mockResolvedValue({ data: null, adapterUsed: 'mock', fromCache: false, duration: 10 });
      await expect(service.getDebtHistory(TEST_USER_ID)).rejects.toThrow(PortFallbackException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // handleWebhook (was HandlePaymentWebhookHandler)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('handleWebhook', () => {
    const successPayload: PaymentWebhookPayload = {
      paymentId: 'PAY-2026-001',
      invoiceId: 'INV-2026-001',
      customerId: 'USR-001',
      amount: 123273,
      status: 'success',
      timestamp: '2026-06-09T10:00:00Z',
    };
    const failedPayload: PaymentWebhookPayload = { ...successPayload, status: 'failed' };

    describe('successful payment webhook', () => {
      it('should invalidate invoice cache via deleteByPattern', async () => {
        await service.handleWebhook(successPayload);
        expect(cacheService.deleteByPattern).toHaveBeenCalledWith('cache:v2:port:invoice:*');
      });

      it('should also invalidate debt cache', async () => {
        await service.handleWebhook(successPayload);
        expect(cacheService.deleteByPattern).toHaveBeenCalledWith('cache:v2:port:debt:*');
      });

      it('should return success result', async () => {
        const result = await service.handleWebhook(successPayload);
        expect(result).toEqual({ processed: true, paymentId: 'PAY-2026-001', status: 'success' });
      });

      it('should store idempotency result', async () => {
        await service.handleWebhook(successPayload);
        expect(idempotencyService.store).toHaveBeenCalledWith(
          'PAY-2026-001',
          expect.objectContaining({ processed: true, status: 'success' }),
          'HandlePaymentWebhook',
        );
      });

      it('should dispatch notification via portRegistry on success', async () => {
        await service.handleWebhook(successPayload);
        const notifCall = portRegistry.execute.mock.calls.find(
          (c: any[]) => c[0] === 'notification' && c[1] === 'dispatch-notification',
        );
        expect(notifCall).toBeDefined();
        const params = notifCall![2];
        expect(params.type).toBe('payment_completed');
        expect(params.isCritical).toBe(true);
        expect(params.customerId).toBe('USR-001');
        expect(params.invoiceId).toBe('INV-2026-001');
        expect(params.amount).toBe(123273);
      });
    });

    describe('failed payment webhook', () => {
      it('should NOT invalidate cache on failed payment', async () => {
        await service.handleWebhook(failedPayload);
        expect(cacheService.deleteByPattern).not.toHaveBeenCalled();
      });

      it('should return failed result', async () => {
        const result = await service.handleWebhook(failedPayload);
        expect(result).toEqual({ processed: true, paymentId: 'PAY-2026-001', status: 'failed' });
      });

      it('should store idempotency result for failed payment', async () => {
        await service.handleWebhook(failedPayload);
        expect(idempotencyService.store).toHaveBeenCalledWith(
          'PAY-2026-001',
          expect.objectContaining({ processed: true, status: 'failed' }),
          'HandlePaymentWebhook',
        );
      });

      it('should log failure with PII redacted', async () => {
        const warnSpy = jest.spyOn(service['logger'], 'warn');
        await service.handleWebhook(failedPayload);
        const warnMsg = warnSpy.mock.calls[0][0];
        expect(warnMsg).toContain('Payment failed');
        expect(warnMsg).toContain('[REDACTED]');
      });

      it('should dispatch notification via portRegistry on failure', async () => {
        await service.handleWebhook(failedPayload);
        const notifCall = portRegistry.execute.mock.calls.find(
          (c: any[]) => c[0] === 'notification' && c[1] === 'dispatch-notification',
        );
        expect(notifCall).toBeDefined();
        expect(notifCall![2].type).toBe('payment_failed');
        expect(notifCall![2].isCritical).toBe(true);
      });
    });

    describe('duplicate webhook (idempotency)', () => {
      const duplicateExisting = {
        result: { processed: true, paymentId: 'PAY-2026-001', status: 'success' },
        storedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        commandType: 'HandlePaymentWebhook',
      };

      it('should return duplicate result without reprocessing', async () => {
        idempotencyService.getExisting.mockResolvedValue(duplicateExisting);
        const result = await service.handleWebhook(successPayload);
        expect(result).toEqual({ processed: false, paymentId: 'PAY-2026-001', status: 'duplicate' });
      });

      it('should NOT invalidate cache on duplicate webhook', async () => {
        idempotencyService.getExisting.mockResolvedValue(duplicateExisting);
        await service.handleWebhook(successPayload);
        expect(cacheService.deleteByPattern).not.toHaveBeenCalled();
      });

      it('should NOT dispatch notification on duplicate', async () => {
        idempotencyService.getExisting.mockResolvedValue(duplicateExisting);
        await service.handleWebhook(successPayload);
        expect(portRegistry.execute).not.toHaveBeenCalled();
      });
    });

    describe('notification dispatch failure', () => {
      it('should still return success when notification dispatch throws', async () => {
        portRegistry.execute.mockRejectedValue(new Error('Circuit breaker open'));
        const result = await service.handleWebhook(successPayload);
        expect(result.processed).toBe(true);
        expect(result.status).toBe('success');
      });

      it('should still return failed when notification dispatch throws on failure', async () => {
        portRegistry.execute.mockRejectedValue(new Error('Circuit breaker open'));
        const result = await service.handleWebhook(failedPayload);
        expect(result.processed).toBe(true);
        expect(result.status).toBe('failed');
      });
    });

    describe('payload validation', () => {
      it('should throw ValidationException for missing paymentId', async () => {
        await expect(
          service.handleWebhook({ ...successPayload, paymentId: undefined }),
        ).rejects.toThrow(ValidationException);
      });

      it('should throw ValidationException for invalid status', async () => {
        await expect(
          service.handleWebhook({ ...successPayload, status: 'pending' }),
        ).rejects.toThrow(ValidationException);
      });

      it('should throw ValidationException for empty body', async () => {
        await expect(service.handleWebhook({})).rejects.toThrow(ValidationException);
      });
    });
  });
});
