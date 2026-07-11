import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PortRegistry } from '@shared/port';
import { PortFallbackException } from '@shared/port/port-exceptions';
import { GetReportDetailQuery, GetReportDetailResult } from '../get-report-detail.query';
import type { ReportDetail } from '../../dtos/incident.dto';

@QueryHandler(GetReportDetailQuery)
export class GetReportDetailHandler implements IQueryHandler<GetReportDetailQuery> {
  constructor(private readonly portRegistry: PortRegistry) {}

  async execute(query: GetReportDetailQuery): Promise<GetReportDetailResult> {
    const result = await this.portRegistry.execute<ReportDetail>(
      'incident',
      'get-report-detail',
      { reportId: query.reportId },
    );
    if (!result?.data) throw new PortFallbackException('incident');
    return result.data;
  }
}
