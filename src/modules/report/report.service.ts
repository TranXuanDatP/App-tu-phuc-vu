/**
 * Report service — lean BFF orchestrator over the 'incident' port.
 * Thin pass-through to PortRegistry; no business logic (BFF owns no
 * incident/triage logic). Methods are the former CQRS handlers' execute()
 * bodies. Port name stays 'incident' (FE contract / downstream incident-service).
 */
import { Injectable } from '@nestjs/common';
import { PortRegistry } from '@shared/port';
import { ValidationException } from '@core/common';
import {
  CreateIncidentRequestSchema,
  UpdateIncidentStatusRequestSchema,
  GisTriageRequestSchema,
  CreateReportRequestSchema,
} from './dto/incident.dto';
import type {
  IncidentListResponse,
  IncidentDetail,
  CreateIncidentResult,
  UpdateIncidentStatusResult,
  GisTriageResult,
  CreateReportResult,
  IncidentReportListResponse,
  ReportDetail,
} from './dto/incident.dto';

@Injectable()
export class ReportService {
  constructor(private readonly portRegistry: PortRegistry) {}

  async listIncidents(filters?: {
    status?: string;
    area?: string;
    type?: string;
    severity?: string;
  }): Promise<IncidentListResponse> {
    const result = await this.portRegistry.execute<IncidentListResponse>(
      'incident',
      'get-incidents',
      {
        status: filters?.status,
        area: filters?.area,
        type: filters?.type,
        severity: filters?.severity,
      },
    );
    return result.data;
  }

  async getIncidentDetail(incidentId: string): Promise<IncidentDetail> {
    const result = await this.portRegistry.execute<IncidentDetail>(
      'incident',
      'get-incident-detail',
      { incidentId },
    );
    return result.data;
  }

  /** Validate → create incident downstream. */
  async createIncident(body: unknown): Promise<CreateIncidentResult> {
    const parsed = CreateIncidentRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.message);
    }
    const result = await this.portRegistry.execute<CreateIncidentResult>(
      'incident',
      'create-incident',
      {
        type: parsed.data.type,
        severity: parsed.data.severity,
        location: parsed.data.location,
        description: parsed.data.description,
        source: parsed.data.source,
        linkedTicketIds: parsed.data.linkedTicketIds,
        useCache: false,
      },
    );
    return result.data;
  }

  /** Validate → update incident status downstream. */
  async updateIncidentStatus(
    incidentId: string,
    body: unknown,
  ): Promise<UpdateIncidentStatusResult> {
    const parsed = UpdateIncidentStatusRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.message);
    }
    const result = await this.portRegistry.execute<UpdateIncidentStatusResult>(
      'incident',
      'update-incident-status',
      {
        incidentId,
        status: parsed.data.status,
        actor: parsed.data.actor,
        description: parsed.data.description,
        useCache: false,
      },
    );
    return result.data;
  }

  /**
   * Validate → GIS triage downstream. Thin pass-through: the BFF does NOT own
   * triage logic — grouping tickets into an incident is the incident-service's
   * job (gis-triage port method).
   */
  async gisTriage(body: unknown): Promise<GisTriageResult> {
    const parsed = GisTriageRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.message);
    }
    const result = await this.portRegistry.execute<GisTriageResult>(
      'incident',
      'gis-triage',
      {
        ticketIds: parsed.data.ticketIds,
        area: parsed.data.area,
        useCache: false,
      },
    );
    return result.data;
  }

  /** Validate → create customer report (Phản ánh) downstream. */
  async createReport(customerId: string, body: unknown): Promise<CreateReportResult> {
    const parsed = CreateReportRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.message);
    }
    const result = await this.portRegistry.execute<CreateReportResult>(
      'incident',
      'create-report',
      {
        customerId,
        type: parsed.data.type,
        description: parsed.data.description,
        location: parsed.data.location,
        photoUrls: parsed.data.photoUrls,
        useCache: false,
      },
    );
    return result.data;
  }

  async getMyReports(
    customerId: string,
    status?: string,
  ): Promise<IncidentReportListResponse> {
    const result = await this.portRegistry.execute<IncidentReportListResponse>(
      'incident',
      'get-my-reports',
      { customerId, status },
    );
    return result.data;
  }

  async getReportDetail(customerId: string, reportId: string): Promise<ReportDetail> {
    const result = await this.portRegistry.execute<ReportDetail>(
      'incident',
      'get-report-detail',
      { customerId, reportId },
    );
    return result.data;
  }
}
