import { ServiceRequestService } from './service-request.service';
import { ValidationException } from '@core/common';

const TEST_USER_ID = 'USR-SESSION-001';

describe('ServiceRequestService', () => {
  let service: ServiceRequestService;
  let portRegistry: { execute: jest.Mock };

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

  const mockEcontract = {
    dossierId: 'DOS-2026-0042', customerId: TEST_USER_ID, status: 'pending_signature',
    downloadUrl: 'https://storage.test/econtract/DOS-2026-0042.pdf', signedAt: null,
  };

  const mockSigned = { dossierId: 'DOS-2026-0042', status: 'signed', signedAt: '2026-07-09T09:30:00Z' };

  beforeEach(() => {
    portRegistry = { execute: jest.fn() };
    service = new ServiceRequestService(portRegistry as any);
  });

  // ── Contract port ────────────────────────────────────────────────────────────

  describe('getContracts', () => {
    it('calls contract/get-contracts with status filter and returns data', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockContracts });
      const result = await service.getContracts(TEST_USER_ID, { status: 'active' });
      expect(portRegistry.execute).toHaveBeenCalledWith('contract', 'get-contracts', {
        customerId: TEST_USER_ID,
        filters: { status: 'active' },
      });
      expect(result).toEqual(mockContracts);
    });

    it('passes undefined filters for empty query', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockContracts });
      await service.getContracts(TEST_USER_ID, {});
      expect(portRegistry.execute).toHaveBeenCalledWith('contract', 'get-contracts', {
        customerId: TEST_USER_ID,
        filters: {},
      });
    });

    it('passes undefined filters for invalid status (lenient read)', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockContracts });
      await service.getContracts(TEST_USER_ID, { status: 'pending' });
      expect(portRegistry.execute).toHaveBeenCalledWith('contract', 'get-contracts', {
        customerId: TEST_USER_ID,
        filters: undefined,
      });
    });
  });

  describe('getContractDetail', () => {
    it('calls contract/get-contract-detail and returns data', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockDetail });
      const result = await service.getContractDetail(TEST_USER_ID, 'CTR-001');
      expect(portRegistry.execute).toHaveBeenCalledWith('contract', 'get-contract-detail', {
        customerId: TEST_USER_ID,
        contractId: 'CTR-001',
      });
      expect(result).toEqual(mockDetail);
    });

    it('throws ValidationException for empty contractId', async () => {
      await expect(service.getContractDetail(TEST_USER_ID, '')).rejects.toThrow(ValidationException);
    });

    it('throws ValidationException for contractId with special characters', async () => {
      await expect(
        service.getContractDetail(TEST_USER_ID, '<script>alert(1)</script>'),
      ).rejects.toThrow(ValidationException);
    });

    it('throws ValidationException for contractId exceeding 100 chars', async () => {
      const longId = 'A'.repeat(101);
      await expect(service.getContractDetail(TEST_USER_ID, longId)).rejects.toThrow(ValidationException);
    });

    it('accepts valid contractId with dashes and underscores', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockDetail });
      await service.getContractDetail(TEST_USER_ID, 'CTR-2024_001');
      expect(portRegistry.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('getContractVersions', () => {
    it('calls contract/get-contract-versions and returns data', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockVersions });
      const result = await service.getContractVersions(TEST_USER_ID, 'CTR-001');
      expect(portRegistry.execute).toHaveBeenCalledWith('contract', 'get-contract-versions', {
        customerId: TEST_USER_ID,
        contractId: 'CTR-001',
      });
      expect(result).toEqual(mockVersions);
    });

    it('throws ValidationException for invalid contractId', async () => {
      await expect(service.getContractVersions(TEST_USER_ID, 'CTR@LID!')).rejects.toThrow(
        ValidationException,
      );
    });
  });

  describe('getContractPDF', () => {
    it('calls contract/get-contract-pdf and returns data', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockPDF });
      const result = await service.getContractPDF(TEST_USER_ID, 'CTR-001');
      expect(portRegistry.execute).toHaveBeenCalledWith('contract', 'get-contract-pdf', {
        customerId: TEST_USER_ID,
        contractId: 'CTR-001',
      });
      expect(result).toEqual(mockPDF);
    });

    it('throws ValidationException for invalid contractId', async () => {
      await expect(service.getContractPDF(TEST_USER_ID, '')).rejects.toThrow(ValidationException);
    });
  });

  // ── Econtract port ───────────────────────────────────────────────────────────

  describe('getEcontract', () => {
    it('calls econtract/get-contract with dossierId and returns data', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockEcontract });
      const result = await service.getEcontract(TEST_USER_ID, 'DOS-2026-0042');
      expect(portRegistry.execute).toHaveBeenCalledWith('econtract', 'get-contract', {
        customerId: TEST_USER_ID,
        dossierId: 'DOS-2026-0042',
      });
      expect(result).toEqual(mockEcontract);
    });
  });

  describe('signEcontract', () => {
    it('validates body, calls econtract/sign-contract with signatureRef + useCache:false, returns data', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockSigned });
      const result = await service.signEcontract(TEST_USER_ID, 'DOS-2026-0042', {
        signatureRef: 'sig-ref-1',
      });
      expect(portRegistry.execute).toHaveBeenCalledWith('econtract', 'sign-contract', {
        customerId: TEST_USER_ID,
        dossierId: 'DOS-2026-0042',
        signatureRef: 'sig-ref-1',
        useCache: false,
      });
      expect(result).toEqual(mockSigned);
    });

    it('throws ValidationException for empty signatureRef', async () => {
      await expect(
        service.signEcontract(TEST_USER_ID, 'DOS-2026-0042', { signatureRef: '' }),
      ).rejects.toThrow(ValidationException);
    });

    it('throws ValidationException for missing signatureRef', async () => {
      await expect(service.signEcontract(TEST_USER_ID, 'DOS-2026-0042', {})).rejects.toThrow(
        ValidationException,
      );
    });
  });
});
