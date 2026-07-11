import { ICommand } from '@core/application';
import type { CreateReportResult } from '../dtos/incident.dto';

export class CreateReportCommand implements ICommand {
  constructor(
    public readonly customerId: string,
    public readonly type: string,
    public readonly description: string,
    public readonly location: { lat: number; lng: number; address: string; area: string | null },
    public readonly photoUrls?: string[],
  ) {}
}
export type CreateReportResultType = CreateReportResult;
