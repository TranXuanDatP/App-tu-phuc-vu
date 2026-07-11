import { ICommand } from '@core/application';
import type { GisTriageResult } from '../dtos/incident.dto';

export class GisTriageCommand implements ICommand {
  constructor(
    public readonly ticketIds: string[],
    public readonly area?: string,
  ) {}
}
export type GisTriageResultType = GisTriageResult;
