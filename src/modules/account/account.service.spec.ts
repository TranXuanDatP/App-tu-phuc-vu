import { AccountService } from './account.service';
import { ValidationException } from '@core/common';

describe('AccountService', () => {
  let service: AccountService;
  let portRegistry: { execute: jest.Mock };

  const TEST_USER_ID = 'USR-SESSION-001';
  const mockProfile = {
    customerId: TEST_USER_ID,
    fullName: 'Test User',
    classification: 'sinh_hoat',
    address: { street: '1', ward: '2', district: '3', city: '4', fullAddress: '1, 2, 3, 4' },
    contactInfo: { phone: '0901234567', email: null, contactAddress: null },
    status: 'active',
  };

  beforeEach(() => {
    portRegistry = { execute: jest.fn() };
    service = new AccountService(portRegistry as any);
  });

  describe('getProfile', () => {
    it('calls customer-profile/get-profile and returns data', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockProfile });
      const result = await service.getProfile(TEST_USER_ID);
      expect(portRegistry.execute).toHaveBeenCalledWith('customer-profile', 'get-profile', {
        customerId: TEST_USER_ID,
      });
      expect(result).toEqual(mockProfile);
    });
  });

  describe('getTimeline', () => {
    it('calls customer-profile/get-timeline with filters', async () => {
      const timeline = { entries: [], totalCount: 0 };
      portRegistry.execute.mockResolvedValue({ data: timeline });
      const result = await service.getTimeline(TEST_USER_ID, { limit: 5 });
      expect(portRegistry.execute).toHaveBeenCalledWith('customer-profile', 'get-timeline', {
        customerId: TEST_USER_ID,
        filters: { limit: 5 },
      });
      expect(result).toEqual(timeline);
    });
  });

  describe('getRelatedAccounts', () => {
    it('calls customer-profile/get-related-accounts', async () => {
      const related = { accounts: [] };
      portRegistry.execute.mockResolvedValue({ data: related });
      const result = await service.getRelatedAccounts(TEST_USER_ID);
      expect(portRegistry.execute).toHaveBeenCalledWith(
        'customer-profile',
        'get-related-accounts',
        { customerId: TEST_USER_ID },
      );
      expect(result).toEqual(related);
    });
  });

  describe('updateProfile', () => {
    it('validates, updates downstream, then re-fetches fresh profile', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockProfile });
      const result = await service.updateProfile(TEST_USER_ID, { phone: '0912345678' });
      expect(portRegistry.execute).toHaveBeenCalledWith('customer-profile', 'update-profile', {
        customerId: TEST_USER_ID,
        data: { phone: '0912345678' },
      });
      expect(portRegistry.execute).toHaveBeenCalledWith('customer-profile', 'get-profile', {
        customerId: TEST_USER_ID,
      });
      expect(result).toEqual(mockProfile);
    });

    it('throws ValidationException for empty phone', async () => {
      await expect(service.updateProfile(TEST_USER_ID, { phone: '' })).rejects.toThrow(
        ValidationException,
      );
    });

    it('throws ValidationException for invalid email', async () => {
      await expect(service.updateProfile(TEST_USER_ID, { email: 'not-an-email' })).rejects.toThrow(
        ValidationException,
      );
    });

    it('throws ValidationException for empty contactAddress', async () => {
      await expect(
        service.updateProfile(TEST_USER_ID, { contactAddress: '' }),
      ).rejects.toThrow(ValidationException);
    });

    it('accepts a valid email update', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockProfile });
      await service.updateProfile(TEST_USER_ID, { email: 'new@email.com' });
      expect(portRegistry.execute).toHaveBeenCalled();
    });
  });

  // ── Onboarding ─────────────────────────────────────────────────────────────

  describe('createOnboardingRequest', () => {
    const createData = { requestId: 'ONB-1', stage: 'submitted', createdAt: '2026-07-07T10:00:00Z' };

    it('validates, calls onboarding/create-onboarding-request and returns data', async () => {
      portRegistry.execute.mockResolvedValue({ data: createData });
      const body = { address: '12 Nguyen Van Cu', customerType: 'sinh_hoat', documents: ['doc-1'] };
      const result = await service.createOnboardingRequest(TEST_USER_ID, body);
      expect(portRegistry.execute).toHaveBeenCalledWith('onboarding', 'create-onboarding-request', {
        customerId: TEST_USER_ID,
        address: '12 Nguyen Van Cu',
        customerType: 'sinh_hoat',
        documents: ['doc-1'],
        useCache: false,
      });
      expect(result).toEqual(createData);
    });

    it('throws ValidationException for empty address', async () => {
      await expect(
        service.createOnboardingRequest(TEST_USER_ID, {
          address: '',
          customerType: 'sinh_hoat',
          documents: [],
        }),
      ).rejects.toThrow(ValidationException);
    });

    it('throws ValidationException for invalid customerType', async () => {
      await expect(
        service.createOnboardingRequest(TEST_USER_ID, {
          address: 'addr',
          customerType: 'unknown',
          documents: [],
        }),
      ).rejects.toThrow(ValidationException);
    });
  });

  describe('getOnboardingStatus', () => {
    it('calls onboarding/get-onboarding-status and returns data', async () => {
      const statusData = {
        requestId: 'ONB-1',
        customerId: TEST_USER_ID,
        stage: 'site_survey',
        createdAt: '2026-07-06T10:00:00Z',
        updatedAt: '2026-07-07T08:30:00Z',
      };
      portRegistry.execute.mockResolvedValue({ data: statusData });
      const result = await service.getOnboardingStatus('ONB-1');
      expect(portRegistry.execute).toHaveBeenCalledWith('onboarding', 'get-onboarding-status', {
        requestId: 'ONB-1',
      });
      expect(result).toEqual(statusData);
    });
  });

  describe('submitDocuments', () => {
    const submitData = {
      requestId: 'ONB-1',
      stage: 'contract',
      uploadedDocumentKeys: ['doc-1'],
      updatedAt: '2026-07-07T09:00:00Z',
    };

    it('validates, calls onboarding/submit-documents and returns data', async () => {
      portRegistry.execute.mockResolvedValue({ data: submitData });
      const result = await service.submitDocuments('ONB-1', TEST_USER_ID, { documents: ['doc-1'] });
      expect(portRegistry.execute).toHaveBeenCalledWith('onboarding', 'submit-documents', {
        requestId: 'ONB-1',
        customerId: TEST_USER_ID,
        documents: ['doc-1'],
        useCache: false,
      });
      expect(result).toEqual(submitData);
    });

    it('throws ValidationException when documents is missing', async () => {
      await expect(service.submitDocuments('ONB-1', TEST_USER_ID, {})).rejects.toThrow(
        ValidationException,
      );
    });

    it('throws ValidationException for non-array documents', async () => {
      await expect(
        service.submitDocuments('ONB-1', TEST_USER_ID, { documents: 'not-an-array' }),
      ).rejects.toThrow(ValidationException);
    });
  });
});
