import { Injectable, Logger } from '@nestjs/common';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import { IPortAdapter } from '@shared/port/port.interface';
import {
  IncidentListResponseSchema,
  IncidentDetailSchema,
  CreateIncidentResultSchema,
  UpdateIncidentStatusResultSchema,
  GisTriageResultSchema,
  CreateReportResultSchema,
  IncidentReportListResponseSchema,
  ReportDetailSchema,
} from '../../application/dtos/incident.dto';

/**
 * Incident Port — operational incidents (Sự cố vận hành) + GIS Triage.
 *
 * Ticket ≠ Incident:
 * - Ticket = CSKH context (customer service, SLA)
 * - Incident = Operations context (GIS, field coordination)
 * - N tickets → 1 incident via GIS Triage
 * - Sensors create incidents without tickets
 *
 * Methods: get-incidents, get-incident-detail, create-incident,
 *          update-incident-status, gis-triage
 */
export interface IIncidentPort extends IPortAdapter {}

@Injectable()
export class MockIncidentAdapter extends MockAdapterBase implements IIncidentPort {
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
