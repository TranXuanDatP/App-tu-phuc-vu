import { UsageService } from './usage.service';
import { ValidationException } from '@core/common';
import { PortFallbackException } from '@shared/port/port-exceptions';

describe('UsageService', () => {
  let service: UsageService;
  let portRegistry: { execute: jest.Mock };

  const TEST_USER_ID = 'USR-SESSION-001';

  const mockMeterList = {
    meters: [
      { meterId: 'MT-001', serialNumber: 'SN-001', type: 'mechanical', diameter: 'DN15', accuracyClass: 'Class B', manufactureYear: 2023, installationDate: '2023-06-15', status: 'active' },
      { meterId: 'MT-002', serialNumber: 'SN-002', type: 'ultrasonic', diameter: 'DN20', accuracyClass: 'Class C', manufactureYear: 2024, installationDate: '2024-01-10', status: 'active' },
    ],
    totalCount: 2,
  };

  const mockReadings = {
    readings: [
      { month: '2025-06', volume: 22, readingDate: '2025-06-30' },
      { month: '2025-05', volume: 18, readingDate: '2025-05-31' },
    ],
    totalCount: 2,
  };

  const mockDetail = {
    period: '2025-06',
    previousIndex: 1247,
    currentIndex: 1269,
    volume: 22,
    evidencePhotos: [
      { url: 'https://storage.ioc.local/photos/001.jpg', caption: 'Meter reading', takenAt: '2025-06-30T09:15:00.000Z' },
    ],
  };

  beforeEach(() => {
    portRegistry = { execute: jest.fn() };
    service = new UsageService(portRegistry as any);
  });

  // ── getMeters (meter / get-meter-by-customer) ───────────────────────────────

  describe('getMeters', () => {
    it('calls meter/get-meter-by-customer and returns data', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockMeterList });
      const result = await service.getMeters(TEST_USER_ID);
      expect(portRegistry.execute).toHaveBeenCalledWith('meter', 'get-meter-by-customer', {
        customerId: TEST_USER_ID,
      });
      expect(result).toEqual(mockMeterList);
    });
  });

  // ── getCalibrationStatus (meter / get-calibration-status) ───────────────────

  describe('getCalibrationStatus', () => {
    const rawCalibration = (status: string) => ({
      meterId: 'MT-001',
      status,
      lastCalibrationDate: '2024-06-15',
      nextCalibrationDate: '2026-06-15',
      certificateNumber: 'CAL-2024-00123',
    });

    it('calls meter/get-calibration-status with customerId + meterId', async () => {
      portRegistry.execute.mockResolvedValue({ data: rawCalibration('expiring_soon') });
      await service.getCalibrationStatus(TEST_USER_ID, 'MT-001');
      expect(portRegistry.execute).toHaveBeenCalledWith('meter', 'get-calibration-status', {
        customerId: TEST_USER_ID,
        meterId: 'MT-001',
      });
    });

    it('computes isWarning=true for status expiring_soon', async () => {
      portRegistry.execute.mockResolvedValue({ data: rawCalibration('expiring_soon') });
      const result = await service.getCalibrationStatus(TEST_USER_ID, 'MT-001');
      expect(result.isWarning).toBe(true);
    });

    it('computes isWarning=true for status expired', async () => {
      portRegistry.execute.mockResolvedValue({ data: rawCalibration('expired') });
      const result = await service.getCalibrationStatus(TEST_USER_ID, 'MT-001');
      expect(result.isWarning).toBe(true);
    });

    it('computes isWarning=false for status valid', async () => {
      portRegistry.execute.mockResolvedValue({ data: rawCalibration('valid') });
      const result = await service.getCalibrationStatus(TEST_USER_ID, 'MT-001');
      expect(result.isWarning).toBe(false);
    });
  });

  // ── getMeterHistory (meter / get-meter-history) ─────────────────────────────

  describe('getMeterHistory', () => {
    it('calls meter/get-meter-history and returns data', async () => {
      const history = {
        entries: [{ eventDate: '2023-06-15', eventType: 'installation', description: 'Installed', performedBy: 'Engineer A' }],
        totalCount: 1,
      };
      portRegistry.execute.mockResolvedValue({ data: history });
      const result = await service.getMeterHistory(TEST_USER_ID, 'MT-001');
      expect(portRegistry.execute).toHaveBeenCalledWith('meter', 'get-meter-history', {
        customerId: TEST_USER_ID,
        meterId: 'MT-001',
      });
      expect(result).toEqual(history);
    });
  });

  // ── getConsumptionHistory (meter-reading / get-readings) ────────────────────

  describe('getConsumptionHistory', () => {
    it('calls meter-reading/get-readings and returns data', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockReadings });
      const result = await service.getConsumptionHistory(TEST_USER_ID);
      expect(portRegistry.execute).toHaveBeenCalledWith('meter-reading', 'get-readings', {
        customerId: TEST_USER_ID,
      });
      expect(result).toEqual(mockReadings);
    });
  });

  // ── getConsumptionComparison (meter-reading / get-comparison) ───────────────

  describe('getConsumptionComparison', () => {
    const rawComparison = (currentVolume: number, previousVolume: number) => ({
      currentPeriod: '2025-06',
      previousPeriod: '2025-05',
      currentVolume,
      previousVolume,
    });

    it('calls meter-reading/get-comparison with customerId + periods', async () => {
      portRegistry.execute.mockResolvedValue({ data: rawComparison(22, 18) });
      await service.getConsumptionComparison(TEST_USER_ID, '2025-06', '2025-05');
      expect(portRegistry.execute).toHaveBeenCalledWith('meter-reading', 'get-comparison', {
        customerId: TEST_USER_ID,
        currentPeriod: '2025-06',
        previousPeriod: '2025-05',
      });
    });

    it('computes percentageChange + direction=up when current > previous', async () => {
      portRegistry.execute.mockResolvedValue({ data: rawComparison(22, 18) });
      const result = await service.getConsumptionComparison(TEST_USER_ID, '2025-06', '2025-05');
      expect(result.percentageChange).toBe(22.22);
      expect(result.direction).toBe('up');
    });

    it('computes direction=down when current < previous', async () => {
      portRegistry.execute.mockResolvedValue({ data: rawComparison(18, 22) });
      const result = await service.getConsumptionComparison(TEST_USER_ID, '2025-06', '2025-05');
      expect(result.direction).toBe('down');
      expect(result.percentageChange).toBeLessThan(0);
    });

    it('computes direction=neutral when volumes are equal', async () => {
      portRegistry.execute.mockResolvedValue({ data: rawComparison(20, 20) });
      const result = await service.getConsumptionComparison(TEST_USER_ID, '2025-06', '2025-05');
      expect(result.percentageChange).toBe(0);
      expect(result.direction).toBe('neutral');
    });

    it('returns percentageChange=null + direction=neutral when previousVolume is 0', async () => {
      portRegistry.execute.mockResolvedValue({ data: rawComparison(22, 0) });
      const result = await service.getConsumptionComparison(TEST_USER_ID, '2025-06', '2025-05');
      expect(result.percentageChange).toBeNull();
      expect(result.direction).toBe('neutral');
    });
  });

  // ── getReadingDetail (meter-reading / get-reading-detail) ───────────────────

  describe('getReadingDetail', () => {
    it('calls meter-reading/get-reading-detail with customerId + period', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockDetail });
      const result = await service.getReadingDetail(TEST_USER_ID, '2025-06');
      expect(portRegistry.execute).toHaveBeenCalledWith('meter-reading', 'get-reading-detail', {
        customerId: TEST_USER_ID,
        period: '2025-06',
      });
      expect(result).toEqual(mockDetail);
    });
  });

  // ── getRealtimeConsumption (smart-meter / get-realtime-consumption) ─────────

  describe('getRealtimeConsumption', () => {
    const consumption = {
      customerId: 'USR-1',
      meterId: 'MTR-1',
      currentFlowM3h: 0.12,
      todayM3: 0.3,
      lastReadingAt: '2026-07-07T08:00:00Z',
    };

    it('calls smart-meter/get-realtime-consumption with customerId and returns data', async () => {
      portRegistry.execute.mockResolvedValue({ data: consumption });
      const result = await service.getRealtimeConsumption('USR-1');
      expect(portRegistry.execute).toHaveBeenCalledWith('smart-meter', 'get-realtime-consumption', {
        customerId: 'USR-1',
      });
      expect(result).toEqual(consumption);
    });

    it('throws PortFallbackException when result.data is null', async () => {
      portRegistry.execute.mockResolvedValue({ data: null });
      await expect(service.getRealtimeConsumption('USR-1')).rejects.toThrow(PortFallbackException);
    });
  });

  // ── getMeterStatus (smart-meter / get-meter-status) ─────────────────────────

  describe('getMeterStatus', () => {
    const status = {
      meterId: 'MTR-1',
      online: true,
      batteryLevel: 82,
      lastSeenAt: '2026-07-07T07:55:00Z',
    };

    it('calls smart-meter/get-meter-status with meterId and returns data', async () => {
      portRegistry.execute.mockResolvedValue({ data: status });
      const result = await service.getMeterStatus('QN-0912345', 'MTR-1');
      expect(portRegistry.execute).toHaveBeenCalledWith('smart-meter', 'get-meter-status', {
        customerId: 'QN-0912345',
        meterId: 'MTR-1',
      });
      expect(result).toEqual(status);
    });

    it('throws PortFallbackException when result.data is null', async () => {
      portRegistry.execute.mockResolvedValue({ data: null });
      await expect(service.getMeterStatus('QN-0912345', 'MTR-1')).rejects.toThrow(PortFallbackException);
    });
  });

  // ── meterId validation ───────────────────────────────────────────────────────

  describe('MeterId validation', () => {
    it('throws ValidationException for empty meterId', async () => {
      await expect(service.getCalibrationStatus(TEST_USER_ID, '')).rejects.toThrow(ValidationException);
    });

    it('throws ValidationException for meterId with special characters', async () => {
      await expect(service.getCalibrationStatus(TEST_USER_ID, 'INV@LID!')).rejects.toThrow(ValidationException);
    });

    it('throws ValidationException for meterId exceeding 100 chars', async () => {
      const longId = 'A'.repeat(101);
      await expect(service.getCalibrationStatus(TEST_USER_ID, longId)).rejects.toThrow(ValidationException);
    });

    it('accepts meterId with dashes', async () => {
      portRegistry.execute.mockResolvedValue({ data: { status: 'valid' } });
      await service.getCalibrationStatus(TEST_USER_ID, 'MT-001');
      expect(portRegistry.execute).toHaveBeenCalledTimes(1);
    });

    it('accepts meterId with underscores', async () => {
      portRegistry.execute.mockResolvedValue({ data: { status: 'valid' } });
      await service.getMeterHistory(TEST_USER_ID, 'MT_001');
      expect(portRegistry.execute).toHaveBeenCalledTimes(1);
    });

    it('accepts meterId with dashes AND underscores', async () => {
      portRegistry.execute.mockResolvedValue({ data: { status: 'valid' } });
      await service.getCalibrationStatus(TEST_USER_ID, 'MT-001_A');
      expect(portRegistry.execute).toHaveBeenCalledTimes(1);
    });
  });

  // ── Period validation ─────────────────────────────────────────────────────────

  describe('Period validation', () => {
    it('throws ValidationException for invalid period format (YYYY/MM)', async () => {
      await expect(service.getReadingDetail(TEST_USER_ID, '2025/06')).rejects.toThrow(ValidationException);
    });

    it('throws ValidationException for incomplete period format', async () => {
      await expect(service.getReadingDetail(TEST_USER_ID, '2025')).rejects.toThrow(ValidationException);
    });

    it('accepts valid YYYY-MM period format', async () => {
      portRegistry.execute.mockResolvedValue({ data: mockDetail });
      await service.getReadingDetail(TEST_USER_ID, '2025-06');
      expect(portRegistry.execute).toHaveBeenCalledTimes(1);
    });
  });

  // ── Comparison params validation ──────────────────────────────────────────────

  describe('Comparison params validation', () => {
    it('throws ValidationException for invalid current param', async () => {
      await expect(
        service.getConsumptionComparison(TEST_USER_ID, 'invalid', '2025-05'),
      ).rejects.toThrow(ValidationException);
    });

    it('throws ValidationException for invalid previous param', async () => {
      await expect(
        service.getConsumptionComparison(TEST_USER_ID, '2025-06', 'invalid'),
      ).rejects.toThrow(ValidationException);
    });

    it('throws ValidationException for both invalid params', async () => {
      await expect(
        service.getConsumptionComparison(TEST_USER_ID, 'abc', 'xyz'),
      ).rejects.toThrow(ValidationException);
    });

    it('accepts valid YYYY-MM for both params', async () => {
      portRegistry.execute.mockResolvedValue({ data: { currentVolume: 1, previousVolume: 1 } });
      await service.getConsumptionComparison(TEST_USER_ID, '2025-06', '2025-05');
      expect(portRegistry.execute).toHaveBeenCalledTimes(1);
    });

    it('throws ValidationException for missing current param (undefined)', async () => {
      await expect(
        service.getConsumptionComparison(TEST_USER_ID, undefined as any, '2025-05'),
      ).rejects.toThrow(ValidationException);
    });

    it('throws ValidationException for missing previous param (undefined)', async () => {
      await expect(
        service.getConsumptionComparison(TEST_USER_ID, '2025-06', undefined as any),
      ).rejects.toThrow(ValidationException);
    });

    it('throws ValidationException for both params missing', async () => {
      await expect(
        service.getConsumptionComparison(TEST_USER_ID, undefined as any, undefined as any),
      ).rejects.toThrow(ValidationException);
    });
  });
});
