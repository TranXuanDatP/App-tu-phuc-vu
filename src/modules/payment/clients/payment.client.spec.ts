import { MockPaymentAdapter } from './payment.client';
import {
  CreatePaymentResponseSchema,
  CreatePaymentRequestSchema,
  PaymentMethodSchema,
  PaymentHistoryResponseSchema,
  CreateBatchPaymentResponseSchema,
  CreateBatchPaymentRequestSchema,
  PaymentHistoryQuerySchema,
  SetupAutoDebitResponseSchema,
  SetupAutoDebitRequestSchema,
  BankAccountSchema,
} from '../dto/payment.dto';

describe('MockPaymentAdapter', () => {
  let adapter: MockPaymentAdapter;

  beforeEach(() => {
    adapter = new MockPaymentAdapter();
  });

  // ── AC#1: create-payment ─────────────────────────────────────────────────────

  describe('execute - create-payment', () => {
    it('should read and validate create-payment.json mock data', async () => {
      const result = await adapter.execute('create-payment', {
        invoiceId: 'INV-2026-001',
        customerId: 'USR-001',
        method: 'qr_code',
        amount: 123273,
      });

      expect(result).toBeDefined();
      const parsed = CreatePaymentResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.paymentId).toBeDefined();
        expect(parsed.data.invoiceId).toBe('INV-2026-001');
        expect(parsed.data.amount).toBe(123273);
        expect(parsed.data.method).toBe('qr_code');
        expect(parsed.data.status).toBe('pending');
        expect(parsed.data.expiresAt).toBeDefined();
        expect(parsed.data.createdAt).toBeDefined();
      }
    });

    it('should have valid URL for qrCodeUrl when method is qr_code', async () => {
      const result = await adapter.execute('create-payment', {
        invoiceId: 'INV-2026-001',
        method: 'qr_code',
      });

      const parsed = CreatePaymentResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.qrCodeUrl).toMatch(/^https?:\/\//);
      }
    });
  });

  // ── Story 4.3 — AC#1: get-payment-history ──────────────────────────────────

  describe('execute - get-payment-history', () => {
    it('should read and validate get-payment-history.json mock data', async () => {
      const result = await adapter.execute('get-payment-history', {
        customerId: 'USR-001',
        filters: { page: 1, limit: 10 },
      });

      expect(result).toBeDefined();
      const parsed = PaymentHistoryResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.payments).toBeInstanceOf(Array);
        expect(parsed.data.payments.length).toBeGreaterThan(0);
        expect(parsed.data.totalCount).toBeGreaterThan(0);
        expect(parsed.data.page).toBe(1);
        expect(parsed.data.limit).toBe(10);
        expect(parsed.data.totalPages).toBeGreaterThan(0);
      }
    });

    it('should have valid payment items with required fields', async () => {
      const result = await adapter.execute('get-payment-history', {
        customerId: 'USR-001',
        filters: { page: 1, limit: 10 },
      });

      const parsed = PaymentHistoryResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        const item = parsed.data.payments[0];
        expect(item.paymentId).toBeDefined();
        expect(item.invoiceIds).toBeInstanceOf(Array);
        expect(item.amount).toBeGreaterThanOrEqual(0);
        expect(item.method).toBeDefined();
        expect(item.status).toBeDefined();
        expect(item.createdAt).toBeDefined();
      }
    });
  });

  // ── Story 4.3 — AC#2: create-batch-payment ─────────────────────────────────

  describe('execute - create-batch-payment', () => {
    it('should read and validate create-batch-payment.json mock data', async () => {
      const result = await adapter.execute('create-batch-payment', {
        invoiceIds: ['INV-2026-001', 'INV-2026-002'],
        customerId: 'USR-001',
        method: 'qr_code',
        totalAmount: 368819,
      });

      expect(result).toBeDefined();
      const parsed = CreateBatchPaymentResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.paymentId).toBeDefined();
        expect(parsed.data.invoiceIds).toBeInstanceOf(Array);
        expect(parsed.data.invoiceIds.length).toBeGreaterThan(1);
        expect(parsed.data.totalAmount).toBeGreaterThan(0);
        expect(parsed.data.method).toBe('qr_code');
        expect(parsed.data.status).toBe('pending');
        expect(parsed.data.expiresAt).toBeDefined();
        expect(parsed.data.createdAt).toBeDefined();
      }
    });

    it('should have valid qrCodeUrl for qr_code method', async () => {
      const result = await adapter.execute('create-batch-payment', {
        invoiceIds: ['INV-2026-001'],
        customerId: 'USR-001',
        method: 'qr_code',
        totalAmount: 100000,
      });

      const parsed = CreateBatchPaymentResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.qrCodeUrl).toMatch(/^https?:\/\//);
      }
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────────

  describe('execute - missing method', () => {
    it('should throw for missing mock file', async () => {
      await expect(adapter.execute('nonexistent', {})).rejects.toThrow();
    });
  });

  // ── Input validation schemas ────────────────────────────────────────────────

  describe('CreatePaymentRequestSchema', () => {
    it('should accept valid payment request', () => {
      const result = CreatePaymentRequestSchema.safeParse({
        invoiceId: 'INV-2026-001',
        method: 'qr_code',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.invoiceId).toBe('INV-2026-001');
        expect(result.data.method).toBe('qr_code');
      }
    });

    it('should accept payment_link method', () => {
      expect(CreatePaymentRequestSchema.safeParse({
        invoiceId: 'INV-001',
        method: 'payment_link',
      }).success).toBe(true);
    });

    it('should accept bank_transfer method', () => {
      expect(CreatePaymentRequestSchema.safeParse({
        invoiceId: 'INV-001',
        method: 'bank_transfer',
      }).success).toBe(true);
    });

    it('should reject missing invoiceId', () => {
      expect(CreatePaymentRequestSchema.safeParse({
        method: 'qr_code',
      }).success).toBe(false);
    });

    it('should reject missing method', () => {
      expect(CreatePaymentRequestSchema.safeParse({
        invoiceId: 'INV-001',
      }).success).toBe(false);
    });

    it('should reject invalid method', () => {
      expect(CreatePaymentRequestSchema.safeParse({
        invoiceId: 'INV-001',
        method: 'crypto',
      }).success).toBe(false);
    });

    it('should reject invoiceId with special characters', () => {
      expect(CreatePaymentRequestSchema.safeParse({
        invoiceId: 'INV@LID!',
        method: 'qr_code',
      }).success).toBe(false);
    });

    it('should reject empty invoiceId', () => {
      expect(CreatePaymentRequestSchema.safeParse({
        invoiceId: '',
        method: 'qr_code',
      }).success).toBe(false);
    });

    it('should reject invoiceId exceeding 100 chars', () => {
      expect(CreatePaymentRequestSchema.safeParse({
        invoiceId: 'A'.repeat(101),
        method: 'qr_code',
      }).success).toBe(false);
    });
  });

  // ── Story 4.3 — Batch Payment Request Schema ──────────────────────────────

  describe('CreateBatchPaymentRequestSchema', () => {
    it('should accept valid batch payment request', () => {
      const result = CreateBatchPaymentRequestSchema.safeParse({
        invoiceIds: ['INV-001', 'INV-002'],
        method: 'qr_code',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.invoiceIds).toHaveLength(2);
        expect(result.data.method).toBe('qr_code');
      }
    });

    it('should accept single invoice', () => {
      expect(CreateBatchPaymentRequestSchema.safeParse({
        invoiceIds: ['INV-001'],
        method: 'payment_link',
      }).success).toBe(true);
    });

    it('should accept maximum 20 invoices', () => {
      const ids = Array.from({ length: 20 }, (_, i) => `INV-${String(i).padStart(3, '0')}`);
      expect(CreateBatchPaymentRequestSchema.safeParse({
        invoiceIds: ids,
        method: 'qr_code',
      }).success).toBe(true);
    });

    it('should reject empty invoiceIds array', () => {
      expect(CreateBatchPaymentRequestSchema.safeParse({
        invoiceIds: [],
        method: 'qr_code',
      }).success).toBe(false);
    });

    it('should reject more than 20 invoices', () => {
      const ids = Array.from({ length: 21 }, (_, i) => `INV-${String(i).padStart(3, '0')}`);
      expect(CreateBatchPaymentRequestSchema.safeParse({
        invoiceIds: ids,
        method: 'qr_code',
      }).success).toBe(false);
    });

    it('should reject missing invoiceIds', () => {
      expect(CreateBatchPaymentRequestSchema.safeParse({
        method: 'qr_code',
      }).success).toBe(false);
    });

    it('should reject missing method', () => {
      expect(CreateBatchPaymentRequestSchema.safeParse({
        invoiceIds: ['INV-001'],
      }).success).toBe(false);
    });

    it('should reject invalid invoiceId format', () => {
      expect(CreateBatchPaymentRequestSchema.safeParse({
        invoiceIds: ['INV@LID!'],
        method: 'qr_code',
      }).success).toBe(false);
    });
  });

  // ── Story 4.3 — Payment History Query Schema ──────────────────────────────

  describe('PaymentHistoryQuerySchema', () => {
    it('should accept valid query with all params', () => {
      const result = PaymentHistoryQuerySchema.safeParse({
        page: '1',
        limit: '10',
        status: 'completed',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.limit).toBe(10);
        expect(result.data.status).toBe('completed');
      }
    });

    it('should apply defaults for missing page and limit', () => {
      const result = PaymentHistoryQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.limit).toBe(10);
        expect(result.data.status).toBeUndefined();
      }
    });

    it('should coerce string page/limit to numbers', () => {
      const result = PaymentHistoryQuerySchema.safeParse({ page: '2', limit: '20' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(2);
        expect(result.data.limit).toBe(20);
      }
    });

    it('should reject negative page', () => {
      expect(PaymentHistoryQuerySchema.safeParse({ page: '-1' }).success).toBe(false);
    });

    it('should reject limit > 100', () => {
      expect(PaymentHistoryQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    });

    it('should reject invalid status filter', () => {
      expect(PaymentHistoryQuerySchema.safeParse({ status: 'unknown' }).success).toBe(false);
    });

    it('should accept status: pending', () => {
      expect(PaymentHistoryQuerySchema.safeParse({ status: 'pending' }).success).toBe(true);
    });

    it('should accept status: failed', () => {
      expect(PaymentHistoryQuerySchema.safeParse({ status: 'failed' }).success).toBe(true);
    });
  });

  // ── Zod schema rejection tests ──────────────────────────────────────────────

  describe('Zod schema validation', () => {
    it('PaymentMethodSchema should reject invalid method', () => {
      expect(PaymentMethodSchema.safeParse('cash').success).toBe(false);
    });

    it('CreatePaymentResponseSchema should reject negative amount', () => {
      const result = CreatePaymentResponseSchema.safeParse({
        paymentId: 'PAY-001',
        invoiceId: 'INV-001',
        amount: -100,
        method: 'qr_code',
        qrCodeUrl: 'https://pay.ioc.local/qr/PAY-001',
        paymentLink: null,
        status: 'pending',
        expiresAt: '2026-06-09T10:00:00Z',
        createdAt: '2026-06-09T09:00:00Z',
      });
      expect(result.success).toBe(false);
    });

    it('CreatePaymentResponseSchema should reject invalid qrCodeUrl', () => {
      const result = CreatePaymentResponseSchema.safeParse({
        paymentId: 'PAY-001',
        invoiceId: 'INV-001',
        amount: 100,
        method: 'qr_code',
        qrCodeUrl: 'not-a-url',
        paymentLink: null,
        status: 'pending',
        expiresAt: '2026-06-09T10:00:00Z',
        createdAt: '2026-06-09T09:00:00Z',
      });
      expect(result.success).toBe(false);
    });

    it('CreatePaymentResponseSchema should reject invalid status', () => {
      const result = CreatePaymentResponseSchema.safeParse({
        paymentId: 'PAY-001',
        invoiceId: 'INV-001',
        amount: 100,
        method: 'qr_code',
        qrCodeUrl: 'https://pay.ioc.local/qr/PAY-001',
        paymentLink: null,
        status: 'unknown',
        expiresAt: '2026-06-09T10:00:00Z',
        createdAt: '2026-06-09T09:00:00Z',
      });
      expect(result.success).toBe(false);
    });

    it('CreateBatchPaymentResponseSchema should reject non-positive totalAmount', () => {
      const result = CreateBatchPaymentResponseSchema.safeParse({
        paymentId: 'PAY-BATCH-001',
        invoiceIds: ['INV-001'],
        totalAmount: -1,
        method: 'qr_code',
        qrCodeUrl: 'https://pay.ioc.local/qr/PAY-BATCH-001',
        paymentLink: null,
        status: 'pending',
        expiresAt: '2026-06-09T11:00:00Z',
        createdAt: '2026-06-09T10:00:00Z',
      });
      expect(result.success).toBe(false);
    });

    it('PaymentHistoryResponseSchema should reject missing pagination fields', () => {
      const result = PaymentHistoryResponseSchema.safeParse({
        payments: [],
        // missing totalCount, page, limit, totalPages
      });
      expect(result.success).toBe(false);
    });
  });

  // ── Story 4.4 — Auto Debit mock adapter ─────────────────────────────────────

  describe('execute - setup-auto-debit', () => {
    it('should read and validate setup-auto-debit.json mock data', async () => {
      const result = await adapter.execute('setup-auto-debit', {
        customerId: 'USR-001',
        bankAccount: {
          bankName: 'Vietcombank',
          accountNumber: '1234567890',
          accountHolder: 'Nguyen Van A',
          branchCode: 'VCB001',
        },
      });

      expect(result).toBeDefined();
      const parsed = SetupAutoDebitResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.registrationId).toBeDefined();
        expect(parsed.data.status).toBe('pending_verification');
        expect(parsed.data.registeredAt).toBeDefined();
      }
    });
  });

  // ── Story 4.4 — Auto Debit Request Schema ───────────────────────────────────

  describe('SetupAutoDebitRequestSchema', () => {
    it('should accept valid auto debit request', () => {
      const result = SetupAutoDebitRequestSchema.safeParse({
        bankAccount: {
          bankName: 'Vietcombank',
          accountNumber: '1234567890',
          accountHolder: 'Nguyen Van A',
        },
      });
      expect(result.success).toBe(true);
    });

    it('should accept with optional branchCode', () => {
      expect(SetupAutoDebitRequestSchema.safeParse({
        bankAccount: {
          bankName: 'BIDV',
          accountNumber: '123456',
          accountHolder: 'Test',
          branchCode: 'BIDV001',
        },
      }).success).toBe(true);
    });

    it('should reject missing bankAccount', () => {
      expect(SetupAutoDebitRequestSchema.safeParse({}).success).toBe(false);
    });

    it('should reject invalid accountNumber (letters)', () => {
      expect(SetupAutoDebitRequestSchema.safeParse({
        bankAccount: {
          bankName: 'VCB',
          accountNumber: 'ABC123',
          accountHolder: 'Test',
        },
      }).success).toBe(false);
    });

    it('should reject accountNumber too short (<6 digits)', () => {
      expect(SetupAutoDebitRequestSchema.safeParse({
        bankAccount: {
          bankName: 'VCB',
          accountNumber: '12345',
          accountHolder: 'Test',
        },
      }).success).toBe(false);
    });

    it('should reject accountNumber too long (>20 digits)', () => {
      expect(SetupAutoDebitRequestSchema.safeParse({
        bankAccount: {
          bankName: 'VCB',
          accountNumber: '1'.repeat(21),
          accountHolder: 'Test',
        },
      }).success).toBe(false);
    });

    it('should reject missing accountHolder', () => {
      expect(SetupAutoDebitRequestSchema.safeParse({
        bankAccount: {
          bankName: 'VCB',
          accountNumber: '1234567890',
        },
      }).success).toBe(false);
    });
  });

  // ── Story 4.4 — BankAccount Schema ───────────────────────────────────────────

  describe('BankAccountSchema', () => {
    it('should accept valid bank account', () => {
      const result = BankAccountSchema.safeParse({
        bankName: 'Vietcombank',
        accountNumber: '9876543210',
        accountHolder: 'Nguyen Thi B',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.bankName).toBe('Vietcombank');
        expect(result.data.branchCode).toBeUndefined();
      }
    });

    it('should reject empty bankName', () => {
      expect(BankAccountSchema.safeParse({
        bankName: '',
        accountNumber: '123456',
        accountHolder: 'Test',
      }).success).toBe(false);
    });
  });
});
