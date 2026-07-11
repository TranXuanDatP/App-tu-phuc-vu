import { ICommand } from '@core/application';
import type { CreateIncidentResult } from '../dtos/incident.dto';

export class CreateIncidentCommand implements ICommand {
  constructor(
    public readonly type: string,
    public readonly severity: string,
    public readonly location: { lat: number; lng: number; address: string; area: string | null },
    public readonly description: string,
    public readonly source: string,
    public readonly linkedTicketIds?: string[],
  ) {}
}
export type CreateIncidentResultType = CreateIncidentResult;
