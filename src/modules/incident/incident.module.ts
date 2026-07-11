import { Module, OnModuleInit } from '@nestjs/common';
import { IncidentController } from './infrastructure/http/incident.controller';
import { MockIncidentAdapter } from './infrastructure/ports/incident.port';
import { INCIDENT_PORT_TOKEN } from './constants/tokens';
import { PortRegistry } from '@shared/port';
import { GetIncidentsHandler } from './application/queries/handlers/get-incidents.handler';
import { GetIncidentDetailHandler } from './application/queries/handlers/get-incident-detail.handler';
import { CreateIncidentHandler } from './application/commands/handlers/create-incident.handler';
import { UpdateIncidentStatusHandler } from './application/commands/handlers/update-incident-status.handler';
import { GisTriageHandler } from './application/commands/handlers/gis-triage.handler';
import { CreateReportHandler } from './application/commands/handlers/create-report.handler';
import { GetMyReportsHandler } from './application/queries/handlers/get-my-reports.handler';
import { GetReportDetailHandler } from './application/queries/handlers/get-report-detail.handler';

@Module({
  controllers: [IncidentController],
  providers: [
    MockIncidentAdapter,
    { provide: INCIDENT_PORT_TOKEN, useExisting: MockIncidentAdapter },
    GetIncidentsHandler,
    GetIncidentDetailHandler,
    CreateIncidentHandler,
    UpdateIncidentStatusHandler,
    GisTriageHandler,
    CreateReportHandler,
    GetMyReportsHandler,
    GetReportDetailHandler,
  ],
  exports: [INCIDENT_PORT_TOKEN],
})
export class IncidentModule implements OnModuleInit {
  constructor(
    private readonly portRegistry: PortRegistry,
    private readonly mockAdapter: MockIncidentAdapter,
  ) {}

  onModuleInit() {
    this.portRegistry.register('incident', this.mockAdapter, this.mockAdapter);
  }
}
