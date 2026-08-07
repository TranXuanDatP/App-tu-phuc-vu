import { ReportController } from './report.controller';

/**
 * ReportController is a thin delegate — these tests verify it forwards to the
 * service and returns its result. Input validation lives in the service
 * (see report.service.spec.ts).
 */
describe('ReportController', () => {
  let controller: ReportController;
  let service: {
    listIncidents: jest.Mock;
    getIncidentDetail: jest.Mock;
    createIncident: jest.Mock;
    updateIncidentStatus: jest.Mock;
    gisTriage: jest.Mock;
    createReport: jest.Mock;
    getMyReports: jest.Mock;
    getReportDetail: jest.Mock;
  };

  const TEST_USER_ID = 'USR-SESSION-001';

  beforeEach(() => {
    service = {
      listIncidents: jest.fn(),
      getIncidentDetail: jest.fn(),
      createIncident: jest.fn(),
      updateIncidentStatus: jest.fn(),
      gisTriage: jest.fn(),
      createReport: jest.fn(),
      getMyReports: jest.fn(),
      getReportDetail: jest.fn(),
    };
    controller = new ReportController(service as any);
  });

  it('list delegates filters to service', async () => {
    const list = { incidents: [], totalCount: 0 };
    service.listIncidents.mockResolvedValue(list);
    const result = await controller.list('resolved', 'north', undefined, undefined);
    expect(service.listIncidents).toHaveBeenCalledWith({
      status: 'resolved',
      area: 'north',
      type: undefined,
      severity: undefined,
    });
    expect(result).toEqual(list);
  });

  it('triage delegates body to service', async () => {
    const triaged = { incidentId: 'INC-3' };
    service.gisTriage.mockResolvedValue(triaged);
    const result = await controller.triage({ ticketIds: ['T-1'] });
    expect(service.gisTriage).toHaveBeenCalledWith({ ticketIds: ['T-1'] });
    expect(result).toEqual(triaged);
  });

  it('createReport delegates userId + body to service', async () => {
    const created = { reportId: 'SC-1' };
    service.createReport.mockResolvedValue(created);
    const result = await controller.createReport(TEST_USER_ID, { type: 'leak' });
    expect(service.createReport).toHaveBeenCalledWith(TEST_USER_ID, { type: 'leak' });
    expect(result).toEqual(created);
  });

  it('myReports delegates userId + status to service', async () => {
    const reports = { reports: [], totalCount: 0 };
    service.getMyReports.mockResolvedValue(reports);
    const result = await controller.myReports(TEST_USER_ID, 'reported');
    expect(service.getMyReports).toHaveBeenCalledWith(TEST_USER_ID, 'reported');
    expect(result).toEqual(reports);
  });

  it('reportDetail delegates reportId to service', async () => {
    const detail = { reportId: 'SC-1' };
    service.getReportDetail.mockResolvedValue(detail);
    const result = await controller.reportDetail('QN-0912345', 'SC-1');
    expect(service.getReportDetail).toHaveBeenCalledWith('QN-0912345', 'SC-1');
    expect(result).toEqual(detail);
  });

  it('detail delegates incident id to service', async () => {
    const detail = { incidentId: 'INC-1' };
    service.getIncidentDetail.mockResolvedValue(detail);
    const result = await controller.detail('INC-1');
    expect(service.getIncidentDetail).toHaveBeenCalledWith('INC-1');
    expect(result).toEqual(detail);
  });

  it('create delegates body to service', async () => {
    const created = { incidentId: 'INC-2' };
    service.createIncident.mockResolvedValue(created);
    const result = await controller.create({ type: 'pipe_burst' });
    expect(service.createIncident).toHaveBeenCalledWith({ type: 'pipe_burst' });
    expect(result).toEqual(created);
  });

  it('updateStatus delegates id + body to service', async () => {
    const updated = { incidentId: 'INC-1', status: 'resolved' };
    service.updateIncidentStatus.mockResolvedValue(updated);
    const result = await controller.updateStatus('INC-1', { status: 'resolved' });
    expect(service.updateIncidentStatus).toHaveBeenCalledWith('INC-1', { status: 'resolved' });
    expect(result).toEqual(updated);
  });
});
