/**
 * Report module — lean BFF module (4-part: controller + service + dto + clients).
 * Registers the incident mock port. No domain/, no CQRS handlers.
 * Port name stays 'incident' (FE contract / downstream incident-service).
 */
import { Module, OnModuleInit } from '@nestjs/common';
import { PortRegistry } from '@shared/port';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { MockIncidentAdapter } from './clients/incident.client';

@Module({
  controllers: [ReportController],
  providers: [ReportService, MockIncidentAdapter],
})
export class ReportModule implements OnModuleInit {
  constructor(
    private readonly portRegistry: PortRegistry,
    private readonly mockAdapter: MockIncidentAdapter,
  ) {}

  onModuleInit() {
    this.portRegistry.register('incident', this.mockAdapter, this.mockAdapter);
  }
}
