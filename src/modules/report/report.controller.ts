/**
 * Report controller — REST endpoints for incidents (route prefix /incidents
 * preserved for FE contract). Thin: route + auth → delegates to ReportService.
 *
 * NOTE: route order matters — @Get(':id') MUST stay after the static
 * 'reports' / 'reports/:reportId' routes so it doesn't shadow them.
 */
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/infrastructure/decorators/current-user.decorator';
import { RequiresBinding } from '../binding/decorators/requires-binding.decorator';
import { ReportService } from './report.service';

@ApiTags('Incident')
@ApiBearerAuth('JWT-auth')
@RequiresBinding()
@Controller('incidents')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Get()
  @ApiOperation({ summary: 'List incidents with optional filters' })
  list(
    @Query('status') status?: string,
    @Query('area') area?: string,
    @Query('type') type?: string,
    @Query('severity') severity?: string,
  ) {
    return this.reportService.listIncidents({ status, area, type, severity });
  }

  @Post('triage')
  @ApiOperation({ summary: 'GIS triage: group tickets into an incident' })
  triage(@Body() body: unknown) {
    return this.reportService.gisTriage(body);
  }

  // ── Phản ánh (per-customer report, replaces ticket in app khách) ──────────
  @Post('reports')
  @ApiOperation({ summary: 'Create customer report (Phản ánh)' })
  createReport(@CurrentUser('id') userId: string, @Body() body: unknown) {
    return this.reportService.createReport(userId, body);
  }

  @Get('reports')
  @ApiOperation({ summary: 'List my reports (Phản ánh)' })
  myReports(@CurrentUser('id') userId: string, @Query('status') status?: string) {
    return this.reportService.getMyReports(userId, status);
  }

  @Get('reports/:reportId')
  @ApiOperation({ summary: 'Get report detail' })
  reportDetail(@Param('reportId') reportId: string) {
    return this.reportService.getReportDetail(reportId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get incident detail' })
  detail(@Param('id') id: string) {
    return this.reportService.getIncidentDetail(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create incident' })
  create(@Body() body: unknown) {
    return this.reportService.createIncident(body);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update incident status' })
  updateStatus(@Param('id') id: string, @Body() body: unknown) {
    return this.reportService.updateIncidentStatus(id, body);
  }
}
