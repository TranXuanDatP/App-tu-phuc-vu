import { ICommand } from '@core/application';
import type { UpdateIncidentStatusResult } from '../dtos/incident.dto';

export class UpdateIncidentStatusCommand implements ICommand {
  constructor(
    public readonly incidentId: string,
    public readonly status: string,
    public readonly actor?: string,
    public readonly description?: string,
  ) {}
}
export type UpdateIncidentStatusResultType = UpdateIncidentStatusResult;
