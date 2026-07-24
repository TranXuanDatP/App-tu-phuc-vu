import { BillingService } from './billing.service';
import { ValidationException } from '@core/common';

const TEST_USER_ID = 'USR-SESSION-001';

describe('BillingService', () => {
  let service: BillingService;
  let portRegistry: { execute: jest.Mock };

  const mockList = {
    invoices: [
      { invoiceId: 'INV-001', contractId: 'CTR-001', period: '2026-05', totalAmount: 285000, paymentStatus: 'unpaid', issueDate: '2026-06-01' },
    ],
    totalCount: 1, page: 1, limit: 10, totalPages: 1,
  };

  const mockDetail = {
    invoiceId: 'INV-2026-001',
    contractId: 'CTR-001',
    period: '2026-05',
    lineItems: [{ description: 'Bậc 1', volume: 10, unitPrice: 5973, amount: 59730 }],
    subtotal: 59730,
    fees: [{ feeName: 'VAT', amount: 2987 }],
    totalAmount: 62717,
    paymentStatus: 'unpaid',
    cqtCode: 'CQT-001',
    lookupCode: 'LC-001',
    issueDate: '2026-06-01',
  };

  const mockPdf = {
    invoiceId: 'INV-2026-001',
    pdfUrl: 'https://storage.ioc.local/invoices/INV-2026-001.pdf',
    cqtCode: 'CQT-001',
    lookupCode: 'LC-001',
    digitalSignature: 'signature-payload',
  };

  const mockTariffPlan = {
    planId: 'TARIFF-RES-2025-001',
    planName: 'Bậc thang sinh hoạt',
    customerType: 'residential',
    applicableContractId: 'CTR-2024-0001',
    tiers: [
      { tier: 1, fromVolume: 0, toVolume: 10, pricePerM3: 5973 },
      { tier: 2, fromVolume: 10, toVolume: 20, pricePerM3: 7052 },
    ],
    effectiveFrom: '2025-01-01',
    effectiveTo: null,
  };

  const mockBreakdown = {
    invoiceId: 'INV-2025-06-001',
    contractId: 'CTR-2024-0001',
    tiers: [
      { tier: 1, fromVolume: 0, toVolume: 10, volume: 10, pricePerM3: 5973, subtotal: 59730 },
    ],
    totalBeforeFees: 59730,
  };

  const mockFees = {
    contractId: 'CTR-2024-0001',
    fees: [
      { feeType: 'environmental', feeName: 'Phí bảo vệ môi trường', rate: 10, isPercentage: true },
    ],
    vatPercentage: 5,
  };

  beforeEach(() => {
    portRegistry = { execute: jest.fn() };
    service = new BillingService(portRegistry as any);
  });

  // ── Invoice port ─────────────────────────────────────────────────────────────

  describe('getInvoiceList', () => {
    it('calls invoice/get-list with customerId + filters and returns data', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockList });
      const result = await service.getInvoiceList(TEST_USER_ID, { month: '2026-05', status: 'unpaid', page: '2', limit: '5' });
      expect(portRegistry.execute).toHaveBeenCalledWith('invoice', 'get-list', {
        customerId: TEST_USER_ID,
        month: '2026-05',
        status: 'unpaid',
        page: 2,
        limit: 5,
      });
      expect(result).toEqual(mockList);
    });

    it('applies default page/limit when omitted', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockList });
      await service.getInvoiceList(TEST_USER_ID, {});
      expect(portRegistry.execute).toHaveBeenCalledWith('invoice', 'get-list', {
        customerId: TEST_USER_ID,
        page: 1,
        limit: 10,
      });
    });

    it('throws ValidationException for invalid month', async () => {
      await expect(service.getInvoiceList(TEST_USER_ID, { month: '2026/05' })).rejects.toThrow(ValidationException);
    });

    it('throws ValidationException for invalid status', async () => {
      await expect(service.getInvoiceList(TEST_USER_ID, { status: 'pending' })).rejects.toThrow(ValidationException);
    });

    it('throws ValidationException for limit exceeding 100', async () => {
      await expect(service.getInvoiceList(TEST_USER_ID, { limit: '101' })).rejects.toThrow(ValidationException);
    });
  });

  describe('getInvoiceDetail', () => {
    it('calls invoice/get-by-id and returns data', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockDetail });
      const result = await service.getInvoiceDetail(TEST_USER_ID, 'INV-2026-001');
      expect(portRegistry.execute).toHaveBeenCalledWith('invoice', 'get-by-id', {
        customerId: TEST_USER_ID,
        invoiceId: 'INV-2026-001',
      });
      expect(result).toEqual(mockDetail);
    });

    it('throws ValidationException for empty invoiceId', async () => {
      await expect(service.getInvoiceDetail(TEST_USER_ID, '')).rejects.toThrow(ValidationException);
    });

    it('throws ValidationException for invoiceId with special characters', async () => {
      await expect(service.getInvoiceDetail(TEST_USER_ID, 'INV@LID!')).rejects.toThrow(ValidationException);
    });

    it('accepts invoiceId with dashes', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockDetail });
      await service.getInvoiceDetail(TEST_USER_ID, 'INV-2026-001');
      expect(portRegistry.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('getInvoicePdf', () => {
    it('calls invoice/get-pdf and returns data', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockPdf });
      const result = await service.getInvoicePdf(TEST_USER_ID, 'INV-2026-001');
      expect(portRegistry.execute).toHaveBeenCalledWith('invoice', 'get-pdf', {
        customerId: TEST_USER_ID,
        invoiceId: 'INV-2026-001',
      });
      expect(result).toEqual(mockPdf);
    });

    it('throws ValidationException for invalid invoiceId', async () => {
      await expect(service.getInvoicePdf(TEST_USER_ID, 'INV@LID!')).rejects.toThrow(ValidationException);
    });
  });

  // ── Tariff port ──────────────────────────────────────────────────────────────

  describe('getTariffPlan', () => {
    it('calls tariff/get-tariff-plan and returns data', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockTariffPlan });
      const result = await service.getTariffPlan(TEST_USER_ID, 'CTR-2024-0001');
      expect(portRegistry.execute).toHaveBeenCalledWith('tariff', 'get-tariff-plan', {
        customerId: TEST_USER_ID,
        contractId: 'CTR-2024-0001',
      });
      expect(result).toEqual(mockTariffPlan);
    });

    it('throws ValidationException for empty contractId', async () => {
      await expect(service.getTariffPlan(TEST_USER_ID, '')).rejects.toThrow(ValidationException);
    });

    it('throws ValidationException for contractId with special characters', async () => {
      await expect(service.getTariffPlan(TEST_USER_ID, 'CTR@LID!')).rejects.toThrow(ValidationException);
    });
  });

  describe('getTariffBreakdown', () => {
    it('calls tariff/get-tariff-breakdown with contractId + invoiceId and returns data', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockBreakdown });
      const result = await service.getTariffBreakdown(TEST_USER_ID, 'CTR-2024-0001', 'INV-2025-06-001');
      expect(portRegistry.execute).toHaveBeenCalledWith('tariff', 'get-tariff-breakdown', {
        customerId: TEST_USER_ID,
        contractId: 'CTR-2024-0001',
        invoiceId: 'INV-2025-06-001',
      });
      expect(result).toEqual(mockBreakdown);
    });

    it('throws ValidationException for invalid contractId', async () => {
      await expect(service.getTariffBreakdown(TEST_USER_ID, 'CTR@LID!', 'INV-001')).rejects.toThrow(ValidationException);
    });

    it('throws ValidationException for invalid invoiceId', async () => {
      await expect(service.getTariffBreakdown(TEST_USER_ID, 'CTR-001', 'INV@LID!')).rejects.toThrow(ValidationException);
    });
  });

  describe('getApplicableFees', () => {
    it('calls tariff/get-applicable-fees and returns data', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockFees });
      const result = await service.getApplicableFees(TEST_USER_ID, 'CTR-2024-0001');
      expect(portRegistry.execute).toHaveBeenCalledWith('tariff', 'get-applicable-fees', {
        customerId: TEST_USER_ID,
        contractId: 'CTR-2024-0001',
      });
      expect(result).toEqual(mockFees);
    });

    it('throws ValidationException for empty contractId', async () => {
      await expect(service.getApplicableFees(TEST_USER_ID, '')).rejects.toThrow(ValidationException);
    });
  });
});
