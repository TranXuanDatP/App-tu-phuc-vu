import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PortRegistry } from '@shared/port';
import { PortFallbackException } from '@shared/port/port-exceptions';
import { GetIncidentDetailQuery, GetIncidentDetailResult } from '../get-incident-detail.query';
import type { IncidentDetail } from '../../dtos/incident.dto';

@QueryHandler(GetIncidentDetailQuery)
export class GetIncidentDetailHandler implements IQueryHandler<GetIncidentDetailQuery> {
  constructor(private readonly portRegistry: PortRegistry) {}

  async execute(query: GetIncidentDetailQuery): Promise<GetIncidentDetailResult> {
    const result = await this.portRegistry.execute<IncidentDetail>(
      'incident',
      'get-incident-detail',
      { incidentId: query.incidentId },
    );
    if (!result?.data) throw new PortFallbackException('incident');
    return result.data;
  }
}
