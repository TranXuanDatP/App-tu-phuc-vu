import { IQuery } from '@core/application';
import type { IncidentReportListResponse } from '../dtos/incident.dto';

export class GetMyReportsQuery extends IQuery<IncidentReportListResponse> {
  constructor(
    public readonly customerId: string,
    public readonly status?: string,
  ) {
    super();
  }
}
export type GetMyReportsResult = IncidentReportListResponse;
