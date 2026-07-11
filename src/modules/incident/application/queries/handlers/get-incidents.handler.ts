import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PortRegistry } from '@shared/port';
import { PortFallbackException } from '@shared/port/port-exceptions';
import { GetIncidentsQuery, GetIncidentsResult } from '../get-incidents.query';
import type { IncidentListResponse } from '../../dtos/incident.dto';

@QueryHandler(GetIncidentsQuery)
export class GetIncidentsHandler implements IQueryHandler<GetIncidentsQuery> {
  constructor(private readonly portRegistry: PortRegistry) {}

  async execute(query: GetIncidentsQuery): Promise<GetIncidentsResult> {
    const result = await this.portRegistry.execute<IncidentListResponse>(
      'incident',
      'get-incidents',
      { status: query.status, area: query.area, type: query.type, severity: query.severity },
    );
    if (!result?.data) throw new PortFallbackException('incident');
    return result.data;
  }
}
