import { AccountController, OnboardingController } from './account.controller';

/**
 * AccountController is a thin delegate — these tests verify it forwards to the
 * service and returns its result. Input validation lives in the service
 * (see account.service.spec.ts).
 */
describe('AccountController', () => {
  let controller: AccountController;
  let service: {
    getProfile: jest.Mock;
    getTimeline: jest.Mock;
    getRelatedAccounts: jest.Mock;
    updateProfile: jest.Mock;
  };

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
    service = {
      getProfile: jest.fn(),
      getTimeline: jest.fn(),
      getRelatedAccounts: jest.fn(),
      updateProfile: jest.fn(),
    };
    controller = new AccountController(service as any);
  });

  it('getProfile delegates to service with userId', async () => {
    service.getProfile.mockResolvedValue(mockProfile);
    const result = await controller.getProfile(TEST_USER_ID);
    expect(service.getProfile).toHaveBeenCalledWith(TEST_USER_ID);
    expect(result).toEqual(mockProfile);
  });

  it('getTimeline delegates to service with userId', async () => {
    const timeline = { entries: [], totalCount: 0 };
    service.getTimeline.mockResolvedValue(timeline);
    const result = await controller.getTimeline(TEST_USER_ID);
    expect(service.getTimeline).toHaveBeenCalledWith(TEST_USER_ID);
    expect(result).toEqual(timeline);
  });

  it('getRelatedAccounts delegates to service with userId', async () => {
    const related = { accounts: [] };
    service.getRelatedAccounts.mockResolvedValue(related);
    const result = await controller.getRelatedAccounts(TEST_USER_ID);
    expect(service.getRelatedAccounts).toHaveBeenCalledWith(TEST_USER_ID);
    expect(result).toEqual(related);
  });

  it('updateProfile delegates body to service', async () => {
    service.updateProfile.mockResolvedValue(mockProfile);
    const result = await controller.updateProfile(TEST_USER_ID, { phone: '0912345678' });
    expect(service.updateProfile).toHaveBeenCalledWith(TEST_USER_ID, { phone: '0912345678' });
    expect(result).toEqual(mockProfile);
  });
});

/**
 * OnboardingController is a thin delegate — these tests verify it forwards to
 * the service and returns its result. Input validation lives in the service
 * (see account.service.spec.ts).
 */
describe('OnboardingController', () => {
  let controller: OnboardingController;
  let service: {
    createOnboardingRequest: jest.Mock;
    getOnboardingStatus: jest.Mock;
    submitDocuments: jest.Mock;
  };

  const TEST_USER_ID = 'USR-SESSION-001';
  const REQUEST_ID = 'ONB-1';
  const createResult = { requestId: REQUEST_ID, stage: 'submitted', createdAt: '2026-07-07T10:00:00Z' };
  const statusResult = {
    requestId: REQUEST_ID,
    customerId: TEST_USER_ID,
    stage: 'site_survey',
    createdAt: '2026-07-06T10:00:00Z',
    updatedAt: '2026-07-07T08:30:00Z',
  };
  const submitResult = {
    requestId: REQUEST_ID,
    stage: 'contract',
    uploadedDocumentKeys: ['doc-1'],
    updatedAt: '2026-07-07T09:00:00Z',
  };

  beforeEach(() => {
    service = {
      createOnboardingRequest: jest.fn(),
      getOnboardingStatus: jest.fn(),
      submitDocuments: jest.fn(),
    };
    controller = new OnboardingController(service as any);
  });

  it('create delegates userId + body to service', async () => {
    const body = { address: '12 Nguyen Van Cu', customerType: 'sinh_hoat', documents: ['doc-1'] };
    service.createOnboardingRequest.mockResolvedValue(createResult);
    const result = await controller.create(TEST_USER_ID, body);
    expect(service.createOnboardingRequest).toHaveBeenCalledWith(TEST_USER_ID, body);
    expect(result).toEqual(createResult);
  });

  it('status delegates requestId to service', async () => {
    service.getOnboardingStatus.mockResolvedValue(statusResult);
    const result = await controller.status(REQUEST_ID);
    expect(service.getOnboardingStatus).toHaveBeenCalledWith(REQUEST_ID);
    expect(result).toEqual(statusResult);
  });

  it('submitDocuments delegates requestId, userId + body to service', async () => {
    const body = { documents: ['doc-1'] };
    service.submitDocuments.mockResolvedValue(submitResult);
    const result = await controller.submitDocuments(TEST_USER_ID, REQUEST_ID, body);
    expect(service.submitDocuments).toHaveBeenCalledWith(REQUEST_ID, TEST_USER_ID, body);
    expect(result).toEqual(submitResult);
  });
});
