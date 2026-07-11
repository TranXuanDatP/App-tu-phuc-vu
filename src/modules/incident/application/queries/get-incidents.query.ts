import { IQuery } from '@core/application';
import type { IncidentListResponse } from '../dtos/incident.dto';

export class GetIncidentsQuery extends IQuery<IncidentListResponse> {
  constructor(
    public readonly status?: string,
    public readonly area?: string,
    public readonly type?: string,
    public readonly severity?: string,
  ) {
    super();
  }
}
export type GetIncidentsResult = IncidentListResponse;
