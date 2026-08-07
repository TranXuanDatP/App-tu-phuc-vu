/**
 * Mock adapter for the incident port (downstream incident-service).
 *
 * OWNER-SCOPED for Phản ánh (A2 Layer-2): create-report / get-my-reports / get-report-detail
 * are scoped by the BOUND customerId (reporter). A bound customer sees only their own Phản
 * ánh; get-report-detail for another customer's reportId → 404 (same shape as not-found, no
 * oracle). Incident methods (get-incidents/get-incident-detail/create-incident/triage/...) stay
 * on super (fixture) — incidents are area-level, bound-shared (NOT customer-scoped).
 *
 * The Phản ánh store is in-memory (resets on restart) — acceptable for dev/mock. Swap to an
 * InternalAdapterBase when the real incident-service is ready; ownership then enforced
 * downstream by customerId (SPEC-downstream §1).
 */
import { Injectable, Logger } from '@nestjs/common';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import { NotFoundException } from '@core/common';
import {
  IncidentListResponseSchema,
  IncidentDetailSchema,
  CreateIncidentResultSchema,
  UpdateIncidentStatusResultSchema,
  GisTriageResultSchema,
  CreateReportResultSchema,
  IncidentReportListResponseSchema,
  ReportDetailSchema,
} from '../dto/incident.dto';

interface MockReport {
  reportId: string;
  customerId: string; // reporter
  type: string;
  description: string;
  photoUrls: string[];
  location: { lat: number; lng: number; address: string; area: string };
  status: string;
  incidentId: string | null;
  createdAt: string;
  updatedAt: string;
}

// Module-level counter for Phản ánh created via the mock.
let reportCounter = 42;

@Injectable()
export class MockIncidentAdapter extends MockAdapterBase {
  /** reportId → report. Seeded with 2 reports (one per binding-seed customer) for the IDOR case. */
  private readonly reports = new Map<string, MockReport>([
    [
      'SC-2026-00042',
      {
        reportId: 'SC-2026-00042',
        customerId: 'QN-0912345',
        type: 'water_outage',
        description: 'Mất nước từ sáng nay, khu vực ngõ 5 Trần Phú',
        photoUrls: [],
        location: { lat: 20.9667, lng: 107.3167, address: 'Ngõ 5 Trần Phú', area: 'CP-DMA-1' },
        status: 'in_progress',
        incidentId: 'INC-2026-0042',
        createdAt: '2026-07-08T08:12:00Z',
        updatedAt: '2026-07-08T09:30:00Z',
      },
    ],
    [
      'SC-2026-00038',
      {
        reportId: 'SC-2026-00038',
        customerId: 'QN-0888891',
        type: 'water_quality',
        description: 'Nước có màu vàng đục',
        photoUrls: [],
        location: { lat: 20.9667, lng: 107.3167, address: 'Ngõ 7 Lê Lợi', area: 'CP-DMA-2' },
        status: 'resolved',
        incidentId: 'INC-2026-0039',
        createdAt: '2026-07-05T07:00:00Z',
        updatedAt: '2026-07-05T15:00:00Z',
      },
    ],
  ]);

  constructor() {
    super(
      'incident',
      {
        'get-incidents': IncidentListResponseSchema,
        'get-incident-detail': IncidentDetailSchema,
        'create-incident': CreateIncidentResultSchema,
        'update-incident-status': UpdateIncidentStatusResultSchema,
        'gis-triage': GisTriageResultSchema,
        'create-report': CreateReportResultSchema,
        'get-my-reports': IncidentReportListResponseSchema,
        'get-report-detail': ReportDetailSchema,
      },
      new Logger('incident-mock-adapter'),
    );
  }

  override async execute(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (method === 'create-report') return this.createReport(params);
    if (method === 'get-my-reports') return this.getMyReports(params);
    if (method === 'get-report-detail') return this.getReportDetail(params);
    return super.execute(method, params); // incident methods — area-level, fixture
  }

  private createReport(params: Record<string, unknown>) {
    const customerId = params.customerId as string;
    reportCounter += 1;
    const reportId = `SC-2026-${String(reportCounter).padStart(5, '0')}`;
    const now = new Date().toISOString();
    const report: MockReport = {
      reportId,
      customerId, // reporter = bound customer
      type: (params.type as string) ?? 'other',
      description: (params.description as string) ?? '',
      photoUrls: (params.photoUrls as string[]) ?? [],
      location: (params.location as MockReport['location']) ?? {
        lat: 0,
        lng: 0,
        address: '',
        area: '',
      },
      status: 'submitted',
      incidentId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.reports.set(reportId, report);
    return {
      reportId,
      status: report.status,
      incidentId: null,
      message: 'Phản ánh đã tiếp nhận.',
    };
  }

  private getMyReports(params: Record<string, unknown>) {
    const customerId = params.customerId as string | undefined;
    const status = params.status as string | undefined;
    let owned = customerId
      ? Array.from(this.reports.values()).filter((r) => r.customerId === customerId)
      : Array.from(this.reports.values());
    if (status) owned = owned.filter((r) => r.status === status);
    return { reports: owned, totalCount: owned.length };
  }

  private getReportDetail(params: Record<string, unknown>) {
    const reportId = params.reportId as string;
    const customerId = params.customerId as string | undefined;
    const report = this.reports.get(reportId);
    // IDOR fix: not found OR not the reporter → 404 (no oracle).
    if (!report || (customerId && report.customerId !== customerId)) {
      throw new NotFoundException('Report not found', 'REPORT_NOT_FOUND', {
        reportId,
      });
    }
    return {
      ...report,
      incidentSummary: report.incidentId
        ? {
            incidentId: report.incidentId,
            type: 'pipe_burst',
            status: report.status,
            severity: 'high',
            affectedCustomers: 42,
            assignedTeam: 'TEAM-CP-03',
          }
        : null,
    };
  }
}
