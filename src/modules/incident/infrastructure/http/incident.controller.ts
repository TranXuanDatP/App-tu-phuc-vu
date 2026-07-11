import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { COMMAND_BUS_TOKEN, QUERY_BUS_TOKEN } from '@core/constants/tokens';
import type { ICommandBus, IQueryBus } from '@core/application';
import { CurrentUser } from '@modules/auth/infrastructure/decorators/current-user.decorator';
import { GetIncidentsQuery } from '../../application/queries/get-incidents.query';
import { GetIncidentDetailQuery } from '../../application/queries/get-incident-detail.query';
import { CreateIncidentCommand } from '../../application/commands/create-incident.command';
import { UpdateIncidentStatusCommand } from '../../application/commands/update-incident-status.command';
import { GisTriageCommand } from '../../application/commands/gis-triage.command';
import { CreateReportCommand } from '../../application/commands/create-report.command';
import { GetMyReportsQuery } from '../../application/queries/get-my-reports.query';
import { GetReportDetailQuery } from '../../application/queries/get-report-detail.query';

@ApiTags('Incident')
@ApiBearerAuth('JWT-auth')
@Controller('incidents')
export class IncidentController {
  constructor(
    @Inject(QUERY_BUS_TOKEN) private readonly queryBus: IQueryBus,
    @Inject(COMMAND_BUS_TOKEN) private readonly commandBus: ICommandBus,
  ) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('area') area?: string,
    @Query('type') type?: string,
    @Query('severity') severity?: string,
  ) {
    return this.queryBus.execute(new GetIncidentsQuery(status, area, type, severity));
  }

  @Post('triage')
  async triage(@Body() body: { ticketIds: string[]; area?: string }) {
    return this.commandBus.execute(new GisTriageCommand(body.ticketIds, body.area));
  }

  // ── Phản ánh (per-customer report, replaces ticket in app khách) ──────────
  @Post('reports')
  async createReport(
    @CurrentUser('id') userId: string,
    @Body() body: {
      type: string;
      description: string;
      photoUrls?: string[];
      location: { lat: number; lng: number; address: string; area: string | null };
    },
  ) {
    return this.commandBus.execute(
      new CreateReportCommand(userId, body.type, body.description, body.location, body.photoUrls),
    );
  }

  @Get('reports')
  async myReports(@CurrentUser('id') userId: string, @Query('status') status?: string) {
    return this.queryBus.execute(new GetMyReportsQuery(userId, status));
  }

  @Get('reports/:reportId')
  async reportDetail(@Param('reportId') reportId: string) {
    return this.queryBus.execute(new GetReportDetailQuery(reportId));
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return this.queryBus.execute(new GetIncidentDetailQuery(id));
  }

  @Post()
  async create(@Body() body: {
    type: string;
    severity: string;
    location: { lat: number; lng: number; address: string; area: string | null };
    description: string;
    source: string;
    linkedTicketIds?: string[];
  }) {
    return this.commandBus.execute(
      new CreateIncidentCommand(
        body.type,
        body.severity,
        body.location,
        body.description,
        body.source,
        body.linkedTicketIds,
      ),
    );
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string; actor?: string; description?: string },
  ) {
    return this.commandBus.execute(
      new UpdateIncidentStatusCommand(id, body.status, body.actor, body.description),
    );
  }
}
