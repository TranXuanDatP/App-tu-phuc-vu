/**
 * Incident Contract Tests — lock create-report response shape + lenient type.
 *
 * Verifies: (1) POST /incidents/reports returns {reportId, status, incidentId, message},
 * (2) accepts customer-app types (low_pressure, meter_issue) without ValidationException.
 */
import { ReportService } from '../../src/modules/report/report.service';

const MOCK_REPORT_RESULT = {
  reportId: 'SC-2026-00042',
  status: 'reported',
  incidentId: 'INC-2026-0042',
  message: 'Phản ánh đã ghi nhận.',
};

describe('Incident Contract Tests', () => {
  let reportService: ReportService;
  let mockPortRegistry: { execute: jest.Mock };

  beforeEach(() => {
    mockPortRegistry = { execute: jest.fn().mockResolvedValue({ data: MOCK_REPORT_RESULT }) };
    reportService = new ReportService(mockPortRegistry as any);
  });

  describe('createReport — contract shape', () => {
    it('should return {reportId, status, incidentId, message}', async () => {
      const result = await reportService.createReport('USR-001', {
        type: 'water_outage',
        description: 'Mất nước toàn khu',
        location: { lat: 16.05, lng: 108.2, address: '123 Lê Lợi, Đà Nẵng', area: null },
      });

      expect(result.reportId).toBeDefined();
      expect(result.status).toBe('reported');
      expect(result.incidentId).toBeDefined();
      expect(result.message).toBeDefined();
    });
  });

  describe('createReport — lenient type (wire-service)', () => {
    it('should accept type "low_pressure" (mobile app type)', async () => {
      await expect(
        reportService.createReport('USR-001', {
          type: 'low_pressure',
          description: 'Nước yếu',
          location: { lat: 0, lng: 0, address: 'test', area: null },
        }),
      ).resolves.toBeDefined();
    });

    it('should accept type "meter_issue" (mobile app type)', async () => {
      await expect(
        reportService.createReport('USR-001', {
          type: 'meter_issue',
          description: 'Đồng hồ kẹt',
          location: { lat: 0, lng: 0, address: 'test', area: null },
        }),
      ).resolves.toBeDefined();
    });
  });
});
