import { IQuery } from '@core/application';
import type { IncidentDetail } from '../dtos/incident.dto';

export class GetIncidentDetailQuery extends IQuery<IncidentDetail> {
  constructor(public readonly incidentId: string) {
    super();
  }
}
export type GetIncidentDetailResult = IncidentDetail;
