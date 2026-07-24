import { TariffController, InvoiceController } from './billing.controller';

/**
 * The billing controllers are thin delegates — these tests verify they forward
 * to BillingService and return its result. Input validation lives in the
 * service (see billing.service.spec.ts).
 */
const TEST_USER_ID = 'USR-SESSION-001';

describe('TariffController', () => {
  let controller: TariffController;
  let service: {
    getTariffPlan: jest.Mock;
    getTariffBreakdown: jest.Mock;
    getApplicableFees: jest.Mock;
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
    service = {
      getTariffPlan: jest.fn(),
      getTariffBreakdown: jest.fn(),
      getApplicableFees: jest.fn(),
    };
    controller = new TariffController(service as any);
  });

  it('getTariffPlan delegates to service with userId + contractId', async () => {
    service.getTariffPlan.mockResolvedValue(mockTariffPlan);
    const result = await controller.getTariffPlan(TEST_USER_ID, 'CTR-2024-0001');
    expect(service.getTariffPlan).toHaveBeenCalledWith(TEST_USER_ID, 'CTR-2024-0001');
    expect(result).toEqual(mockTariffPlan);
  });

  it('getTariffBreakdown delegates to service with userId + contractId + invoiceId', async () => {
    service.getTariffBreakdown.mockResolvedValue(mockBreakdown);
    const result = await controller.getTariffBreakdown(TEST_USER_ID, 'CTR-2024-0001', 'INV-2025-06-001');
    expect(service.getTariffBreakdown).toHaveBeenCalledWith(TEST_USER_ID, 'CTR-2024-0001', 'INV-2025-06-001');
    expect(result).toEqual(mockBreakdown);
  });

  it('getApplicableFees delegates to service with userId + contractId', async () => {
    service.getApplicableFees.mockResolvedValue(mockFees);
    const result = await controller.getApplicableFees(TEST_USER_ID, 'CTR-2024-0001');
    expect(service.getApplicableFees).toHaveBeenCalledWith(TEST_USER_ID, 'CTR-2024-0001');
    expect(result).toEqual(mockFees);
  });
});

describe('InvoiceController', () => {
  let controller: InvoiceController;
  let service: {
    getInvoiceList: jest.Mock;
    getInvoiceDetail: jest.Mock;
    getInvoicePdf: jest.Mock;
  };

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

  beforeEach(() => {
    service = {
      getInvoiceList: jest.fn(),
      getInvoiceDetail: jest.fn(),
      getInvoicePdf: jest.fn(),
    };
    controller = new InvoiceController(service as any);
  });

  it('getInvoiceList delegates to service with userId + query', async () => {
    service.getInvoiceList.mockResolvedValue(mockList);
    const query = { month: '2026-05', status: 'unpaid', page: '1', limit: '10' };
    const result = await controller.getInvoiceList(TEST_USER_ID, query);
    expect(service.getInvoiceList).toHaveBeenCalledWith(TEST_USER_ID, query);
    expect(result).toEqual(mockList);
  });

  it('getInvoiceDetail delegates to service with userId + invoiceId', async () => {
    service.getInvoiceDetail.mockResolvedValue(mockDetail);
    const result = await controller.getInvoiceDetail(TEST_USER_ID, 'INV-2026-001');
    expect(service.getInvoiceDetail).toHaveBeenCalledWith(TEST_USER_ID, 'INV-2026-001');
    expect(result).toEqual(mockDetail);
  });

  it('getInvoicePdf delegates to service with userId + invoiceId', async () => {
    service.getInvoicePdf.mockResolvedValue(mockPdf);
    const result = await controller.getInvoicePdf(TEST_USER_ID, 'INV-2026-001');
    expect(service.getInvoicePdf).toHaveBeenCalledWith(TEST_USER_ID, 'INV-2026-001');
    expect(result).toEqual(mockPdf);
  });
});
