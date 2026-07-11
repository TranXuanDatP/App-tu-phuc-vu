import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';
import { PortRegistry } from '@shared/port';
import { PortFallbackException } from '@shared/port/port-exceptions';
import { UpdateIncidentStatusCommand, UpdateIncidentStatusResultType } from '../update-incident-status.command';
import type { UpdateIncidentStatusResult } from '../../dtos/incident.dto';

@CommandHandler(UpdateIncidentStatusCommand)
export class UpdateIncidentStatusHandler implements ICommandHandler<UpdateIncidentStatusCommand> {
  constructor(private readonly portRegistry: PortRegistry) {}

  async execute(command: UpdateIncidentStatusCommand): Promise<UpdateIncidentStatusResultType> {
    const result = await this.portRegistry.execute<UpdateIncidentStatusResult>(
      'incident',
      'update-incident-status',
      {
        incidentId: command.incidentId,
        status: command.status,
        actor: command.actor,
        description: command.description,
        useCache: false,
      },
    );
    if (!result?.data) throw new PortFallbackException('incident');
    return result.data;
  }
}
