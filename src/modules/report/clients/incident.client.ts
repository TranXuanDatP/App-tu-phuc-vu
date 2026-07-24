/**
 * Mock adapter for the incident port (downstream incident-service).
 * Reads mocks/incident/<method>.json. Swap to a real InternalAdapterBase
 * subclass (passed as the 2nd arg of portRegistry.register) when the downstream
 * service is ready — flip config/api-endpoints.yaml `adapter: live`.
 *
 * NOTE: BFF owns no incident/triage logic — this is a thin mock of the port.
 */
import { Injectable, Logger } from '@nestjs/common';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
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

@Injectable()
export class MockIncidentAdapter extends MockAdapterBase {
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
}
