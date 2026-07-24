import { UsageController, SmartMeterController } from './usage.controller';

/**
 * UsageController is a thin delegate — these tests verify it forwards to the
 * service and returns its result. Input validation lives in the service
 * (see usage.service.spec.ts).
 */
describe('UsageController', () => {
  let controller: UsageController;
  let service: {
    getMeters: jest.Mock;
    getConsumptionHistory: jest.Mock;
    getConsumptionComparison: jest.Mock;
    getReadingDetail: jest.Mock;
    getCalibrationStatus: jest.Mock;
    getMeterHistory: jest.Mock;
  };

  const TEST_USER_ID = 'USR-SESSION-001';
  const mockMeterList = {
    meters: [
      { meterId: 'MT-001', serialNumber: 'SN-001', type: 'mechanical', diameter: 'DN15', accuracyClass: 'Class B', manufactureYear: 2023, installationDate: '2023-06-15', status: 'active' },
    ],
    totalCount: 1,
  };

  beforeEach(() => {
    service = {
      getMeters: jest.fn(),
      getConsumptionHistory: jest.fn(),
      getConsumptionComparison: jest.fn(),
      getReadingDetail: jest.fn(),
      getCalibrationStatus: jest.fn(),
      getMeterHistory: jest.fn(),
    };
    controller = new UsageController(service as any);
  });

  it('getMeters delegates to service with userId', async () => {
    service.getMeters.mockResolvedValue(mockMeterList);
    const result = await controller.getMeters(TEST_USER_ID);
    expect(service.getMeters).toHaveBeenCalledWith(TEST_USER_ID);
    expect(result).toEqual(mockMeterList);
  });

  it('getConsumptionHistory delegates to service with userId', async () => {
    const readings = { readings: [], totalCount: 0 };
    service.getConsumptionHistory.mockResolvedValue(readings);
    const result = await controller.getConsumptionHistory(TEST_USER_ID);
    expect(service.getConsumptionHistory).toHaveBeenCalledWith(TEST_USER_ID);
    expect(result).toEqual(readings);
  });

  it('getConsumptionComparison delegates current + previous to service', async () => {
    const comparison = { percentageChange: 22.22, direction: 'up' };
    service.getConsumptionComparison.mockResolvedValue(comparison);
    const result = await controller.getConsumptionComparison(TEST_USER_ID, '2025-06', '2025-05');
    expect(service.getConsumptionComparison).toHaveBeenCalledWith(TEST_USER_ID, '2025-06', '2025-05');
    expect(result).toEqual(comparison);
  });

  it('getReadingDetail delegates period to service', async () => {
    const detail = { period: '2025-06', evidencePhotos: [] };
    service.getReadingDetail.mockResolvedValue(detail);
    const result = await controller.getReadingDetail(TEST_USER_ID, '2025-06');
    expect(service.getReadingDetail).toHaveBeenCalledWith(TEST_USER_ID, '2025-06');
    expect(result).toEqual(detail);
  });

  it('getCalibrationStatus delegates meterId to service', async () => {
    const calibration = { meterId: 'MT-001', isWarning: true };
    service.getCalibrationStatus.mockResolvedValue(calibration);
    const result = await controller.getCalibrationStatus(TEST_USER_ID, 'MT-001');
    expect(service.getCalibrationStatus).toHaveBeenCalledWith(TEST_USER_ID, 'MT-001');
    expect(result).toEqual(calibration);
  });

  it('getMeterHistory delegates meterId to service', async () => {
    const history = { entries: [], totalCount: 0 };
    service.getMeterHistory.mockResolvedValue(history);
    const result = await controller.getMeterHistory(TEST_USER_ID, 'MT-001');
    expect(service.getMeterHistory).toHaveBeenCalledWith(TEST_USER_ID, 'MT-001');
    expect(result).toEqual(history);
  });
});

/**
 * SmartMeterController is a thin delegate over UsageService for the
 * /smart-meter routes (folded from the former smart-meter module).
 */
describe('SmartMeterController', () => {
  let controller: SmartMeterController;
  let service: {
    getRealtimeConsumption: jest.Mock;
    getMeterStatus: jest.Mock;
  };

  const TEST_USER_ID = 'USR-SESSION-001';

  beforeEach(() => {
    service = {
      getRealtimeConsumption: jest.fn(),
      getMeterStatus: jest.fn(),
    };
    controller = new SmartMeterController(service as any);
  });

  it('getRealtimeConsumption delegates to service with userId', async () => {
    const consumption = {
      customerId: TEST_USER_ID,
      meterId: 'MTR-2024-0001',
      currentFlowM3h: 0.12,
      todayM3: 0.32,
      lastReadingAt: '2026-07-07T07:50:00Z',
    };
    service.getRealtimeConsumption.mockResolvedValue(consumption);
    const result = await controller.getRealtimeConsumption(TEST_USER_ID);
    expect(service.getRealtimeConsumption).toHaveBeenCalledWith(TEST_USER_ID);
    expect(result).toEqual(consumption);
  });

  it('getMeterStatus delegates meterId to service', async () => {
    const status = {
      meterId: 'MTR-2024-0001',
      online: true,
      batteryLevel: 82,
      lastSeenAt: '2026-07-07T07:55:00Z',
    };
    service.getMeterStatus.mockResolvedValue(status);
    const result = await controller.getMeterStatus('MTR-2024-0001');
    expect(service.getMeterStatus).toHaveBeenCalledWith('MTR-2024-0001');
    expect(result).toEqual(status);
  });
});
