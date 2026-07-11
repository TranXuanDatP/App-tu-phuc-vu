import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PortRegistry } from '@shared/port';
import { PortFallbackException } from '@shared/port/port-exceptions';
import { GetMyReportsQuery, GetMyReportsResult } from '../get-my-reports.query';
import type { IncidentReportListResponse } from '../../dtos/incident.dto';

@QueryHandler(GetMyReportsQuery)
export class GetMyReportsHandler implements IQueryHandler<GetMyReportsQuery> {
  constructor(private readonly portRegistry: PortRegistry) {}

  async execute(query: GetMyReportsQuery): Promise<GetMyReportsResult> {
    const result = await this.portRegistry.execute<IncidentReportListResponse>(
      'incident',
      'get-my-reports',
      { customerId: query.customerId, status: query.status },
    );
    if (!result?.data) throw new PortFallbackException('incident');
    return result.data;
  }
}
