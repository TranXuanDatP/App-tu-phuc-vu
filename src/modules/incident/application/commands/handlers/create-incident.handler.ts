import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';
import { PortRegistry } from '@shared/port';
import { PortFallbackException } from '@shared/port/port-exceptions';
import { CreateIncidentCommand, CreateIncidentResultType } from '../create-incident.command';
import type { CreateIncidentResult } from '../../dtos/incident.dto';

@CommandHandler(CreateIncidentCommand)
export class CreateIncidentHandler implements ICommandHandler<CreateIncidentCommand> {
  constructor(private readonly portRegistry: PortRegistry) {}

  async execute(command: CreateIncidentCommand): Promise<CreateIncidentResultType> {
    const result = await this.portRegistry.execute<CreateIncidentResult>(
      'incident',
      'create-incident',
      {
        type: command.type,
        severity: command.severity,
        location: command.location,
        description: command.description,
        source: command.source,
        linkedTicketIds: command.linkedTicketIds,
        useCache: false,
      },
    );
    if (!result?.data) throw new PortFallbackException('incident');
    return result.data;
  }
}
