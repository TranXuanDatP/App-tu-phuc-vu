import { IQuery } from '@core/application';
import type { ReportDetail } from '../dtos/incident.dto';

export class GetReportDetailQuery extends IQuery<ReportDetail> {
  constructor(public readonly reportId: string) {
    super();
  }
}
export type GetReportDetailResult = ReportDetail;
