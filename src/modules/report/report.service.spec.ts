import { ReportService } from './report.service';
import { ValidationException } from '@core/common';

describe('ReportService', () => {
  let service: ReportService;
  let portRegistry: { execute: jest.Mock };

  const TEST_USER_ID = 'USR-SESSION-001';
  const location = { lat: 10.762, lng: 106.66, address: '1 Nguyễn Huệ', area: null };

  beforeEach(() => {
    portRegistry = { execute: jest.fn() };
    service = new ReportService(portRegistry as any);
  });

  describe('listIncidents', () => {
    it('calls incident/get-incidents with filters and returns data', async () => {
      const list = { incidents: [], totalCount: 0 };
      portRegistry.execute.mockResolvedValue({ data: list });
      const result = await service.listIncidents({ status: 'resolved', area: 'north' });
      expect(portRegistry.execute).toHaveBeenCalledWith('incident', 'get-incidents', {
        status: 'resolved',
        area: 'north',
        type: undefined,
        severity: undefined,
      });
      expect(result).toEqual(list);
    });

    it('passes undefined filters when none given', async () => {
      portRegistry.execute.mockResolvedValue({ data: { incidents: [], totalCount: 0 } });
      await service.listIncidents();
      expect(portRegistry.execute).toHaveBeenCalledWith('incident', 'get-incidents', {
        status: undefined,
        area: undefined,
        type: undefined,
        severity: undefined,
      });
    });
  });

  describe('getIncidentDetail', () => {
    it('calls incident/get-incident-detail and returns data', async () => {
      const detail = { incidentId: 'INC-1' };
      portRegistry.execute.mockResolvedValue({ data: detail });
      const result = await service.getIncidentDetail('INC-1');
      expect(portRegistry.execute).toHaveBeenCalledWith('incident', 'get-incident-detail', {
        incidentId: 'INC-1',
      });
      expect(result).toEqual(detail);
    });
  });

  describe('createIncident', () => {
    const validBody = {
      type: 'pipe_burst',
      severity: 'high',
      location,
      description: 'vỡ ống lớn',
      source: 'sensor',
    };

    it('validates, calls incident/create-incident with useCache:false, returns data', async () => {
      const created = { incidentId: 'INC-2', status: 'reported', createdAt: '2026-01-01' };
      portRegistry.execute.mockResolvedValue({ data: created });
      const result = await service.createIncident(validBody);
      expect(portRegistry.execute).toHaveBeenCalledWith('incident', 'create-incident', {
        type: 'pipe_burst',
        severity: 'high',
        location,
        description: 'vỡ ống lớn',
        source: 'sensor',
        linkedTicketIds: undefined,
        useCache: false,
      });
      expect(result).toEqual(created);
    });

    it('throws ValidationException for invalid type', async () => {
      await expect(service.createIncident({ ...validBody, type: 'not-a-type' })).rejects.toThrow(
        ValidationException,
      );
    });
  });

  describe('updateIncidentStatus', () => {
    it('validates, calls incident/update-incident-status with incidentId + useCache:false', async () => {
      const updated = { incidentId: 'INC-1', status: 'resolved', updatedAt: '2026-01-02' };
      portRegistry.execute.mockResolvedValue({ data: updated });
      const result = await service.updateIncidentStatus('INC-1', {
        status: 'resolved',
        actor: 'team-a',
        description: 'fixed',
      });
      expect(portRegistry.execute).toHaveBeenCalledWith(
        'incident',
        'update-incident-status',
        {
          incidentId: 'INC-1',
          status: 'resolved',
          actor: 'team-a',
          description: 'fixed',
          useCache: false,
        },
      );
      expect(result).toEqual(updated);
    });

    it('throws ValidationException for invalid status', async () => {
      await expect(
        service.updateIncidentStatus('INC-1', { status: 'not-a-status' }),
      ).rejects.toThrow(ValidationException);
    });
  });

  describe('gisTriage', () => {
    it('validates, calls incident/gis-triage (thin pass-through) with useCache:false', async () => {
      const triaged = {
        incidentId: 'INC-3',
        incidentType: 'pipe_burst',
        severity: 'critical',
        groupedTicketIds: ['T-1', 'T-2'],
        location,
        message: 'grouped',
      };
      portRegistry.execute.mockResolvedValue({ data: triaged });
      const result = await service.gisTriage({ ticketIds: ['T-1', 'T-2'], area: 'north' });
      expect(portRegistry.execute).toHaveBeenCalledWith('incident', 'gis-triage', {
        ticketIds: ['T-1', 'T-2'],
        area: 'north',
        useCache: false,
      });
      expect(result).toEqual(triaged);
    });

    it('throws ValidationException when ticketIds missing', async () => {
      await expect(service.gisTriage({})).rejects.toThrow(ValidationException);
    });
  });

  describe('createReport', () => {
    const validBody = { type: 'leak', description: 'rò rỉ', location };

    it('validates, calls incident/create-report with customerId + useCache:false', async () => {
      const created = {
        reportId: 'SC-1',
        status: 'reported',
        incidentId: null,
        message: 'received',
      };
      portRegistry.execute.mockResolvedValue({ data: created });
      const result = await service.createReport(TEST_USER_ID, validBody);
      expect(portRegistry.execute).toHaveBeenCalledWith('incident', 'create-report', {
        customerId: TEST_USER_ID,
        type: 'leak',
        description: 'rò rỉ',
        location,
        photoUrls: undefined,
        useCache: false,
      });
      expect(result).toEqual(created);
    });

    it('throws ValidationException when location missing', async () => {
      await expect(service.createReport(TEST_USER_ID, { type: 'leak', description: 'x' })).rejects.toThrow(
        ValidationException,
      );
    });
  });

  describe('getMyReports', () => {
    it('calls incident/get-my-reports with customerId + status', async () => {
      const reports = { reports: [], totalCount: 0 };
      portRegistry.execute.mockResolvedValue({ data: reports });
      const result = await service.getMyReports(TEST_USER_ID, 'reported');
      expect(portRegistry.execute).toHaveBeenCalledWith('incident', 'get-my-reports', {
        customerId: TEST_USER_ID,
        status: 'reported',
      });
      expect(result).toEqual(reports);
    });
  });

  describe('getReportDetail', () => {
    it('calls incident/get-report-detail and returns data', async () => {
      const detail = { reportId: 'SC-1' };
      portRegistry.execute.mockResolvedValue({ data: detail });
      const result = await service.getReportDetail('QN-0912345', 'SC-1');
      expect(portRegistry.execute).toHaveBeenCalledWith('incident', 'get-report-detail', {
        customerId: 'QN-0912345',
        reportId: 'SC-1',
      });
      expect(result).toEqual(detail);
    });
  });
});
