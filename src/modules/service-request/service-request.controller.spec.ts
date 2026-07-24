import { ContractController, EcontractController } from './service-request.controller';

/**
 * The service-request controllers are thin delegates — these tests verify they
 * forward to ServiceRequestService and return its result. Input validation
 * lives in the service (see service-request.service.spec.ts).
 */
const TEST_USER_ID = 'USR-SESSION-001';

describe('ContractController', () => {
  let controller: ContractController;
  let service: {
    getContracts: jest.Mock;
    getContractDetail: jest.Mock;
    getContractVersions: jest.Mock;
    getContractPDF: jest.Mock;
  };

  const mockContracts = {
    contracts: [{ contractId: 'CTR-001', address: 'Test', meterId: null, waterQuota: null, subscriptionType: 'residential', status: 'active', startDate: '2024-01-01', endDate: null, pricingTerms: { basePrice: 6500, currency: 'VND', billingCycle: 'monthly' } }],
    totalCount: 1,
  };

  const mockDetail = {
    contractId: 'CTR-001', address: '123 Test', meterId: 'DNG-001', waterQuota: 50,
    subscriptionType: 'residential', status: 'active', startDate: '2024-01-15', endDate: null,
    pricingTerms: { basePrice: 6500, currency: 'VND', billingCycle: 'monthly' },
    specialConditions: null,
  };

  const mockVersions = {
    versions: [{ versionId: 'VER-001', versionNumber: 1, changeDescription: 'Initial', effectiveDate: '2024-01-15', changedBy: 'System' }],
    totalCount: 1,
  };

  const mockPDF = {
    contractId: 'CTR-001', downloadUrl: 'https://storage.test/CTR-001.pdf', fileName: 'Contract.pdf', expiresAt: null,
  };

  beforeEach(() => {
    service = {
      getContracts: jest.fn(),
      getContractDetail: jest.fn(),
      getContractVersions: jest.fn(),
      getContractPDF: jest.fn(),
    };
    controller = new ContractController(service as any);
  });

  it('getContracts delegates to service with userId + query', async () => {
    service.getContracts.mockResolvedValue(mockContracts);
    const result = await controller.getContracts(TEST_USER_ID, { status: 'active' });
    expect(service.getContracts).toHaveBeenCalledWith(TEST_USER_ID, { status: 'active' });
    expect(result).toEqual(mockContracts);
  });

  it('getContracts delegates with empty query', async () => {
    service.getContracts.mockResolvedValue(mockContracts);
    await controller.getContracts(TEST_USER_ID, {});
    expect(service.getContracts).toHaveBeenCalledWith(TEST_USER_ID, {});
  });

  it('getContractDetail delegates to service with userId + contractId', async () => {
    service.getContractDetail.mockResolvedValue(mockDetail);
    const result = await controller.getContractDetail(TEST_USER_ID, 'CTR-001');
    expect(service.getContractDetail).toHaveBeenCalledWith(TEST_USER_ID, 'CTR-001');
    expect(result).toEqual(mockDetail);
  });

  it('getContractVersions delegates to service with userId + contractId', async () => {
    service.getContractVersions.mockResolvedValue(mockVersions);
    const result = await controller.getContractVersions(TEST_USER_ID, 'CTR-001');
    expect(service.getContractVersions).toHaveBeenCalledWith(TEST_USER_ID, 'CTR-001');
    expect(result).toEqual(mockVersions);
  });

  it('getContractPDF delegates to service with userId + contractId', async () => {
    service.getContractPDF.mockResolvedValue(mockPDF);
    const result = await controller.getContractPDF(TEST_USER_ID, 'CTR-001');
    expect(service.getContractPDF).toHaveBeenCalledWith(TEST_USER_ID, 'CTR-001');
    expect(result).toEqual(mockPDF);
  });
});

describe('EcontractController', () => {
  let controller: EcontractController;
  let service: {
    getEcontract: jest.Mock;
    signEcontract: jest.Mock;
  };

  const mockEcontract = {
    dossierId: 'DOS-2026-0042', customerId: TEST_USER_ID, status: 'pending_signature',
    downloadUrl: 'https://storage.test/econtract/DOS-2026-0042.pdf', signedAt: null,
  };

  const mockSigned = { dossierId: 'DOS-2026-0042', status: 'signed', signedAt: '2026-07-09T09:30:00Z' };

  beforeEach(() => {
    service = {
      getEcontract: jest.fn(),
      signEcontract: jest.fn(),
    };
    controller = new EcontractController(service as any);
  });

  it('get delegates to service with userId + dossierId', async () => {
    service.getEcontract.mockResolvedValue(mockEcontract);
    const result = await controller.get(TEST_USER_ID, 'DOS-2026-0042');
    expect(service.getEcontract).toHaveBeenCalledWith(TEST_USER_ID, 'DOS-2026-0042');
    expect(result).toEqual(mockEcontract);
  });

  it('sign delegates to service with userId + dossierId + body', async () => {
    service.signEcontract.mockResolvedValue(mockSigned);
    const result = await controller.sign(TEST_USER_ID, 'DOS-2026-0042', { signatureRef: 'sig-ref-1' });
    expect(service.signEcontract).toHaveBeenCalledWith(TEST_USER_ID, 'DOS-2026-0042', {
      signatureRef: 'sig-ref-1',
    });
    expect(result).toEqual(mockSigned);
  });
});
