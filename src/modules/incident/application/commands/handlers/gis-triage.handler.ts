import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';
import { PortRegistry } from '@shared/port';
import { PortFallbackException } from '@shared/port/port-exceptions';
import { GisTriageCommand, GisTriageResultType } from '../gis-triage.command';
import type { GisTriageResult } from '../../dtos/incident.dto';

@CommandHandler(GisTriageCommand)
export class GisTriageHandler implements ICommandHandler<GisTriageCommand> {
  constructor(private readonly portRegistry: PortRegistry) {}

  async execute(command: GisTriageCommand): Promise<GisTriageResultType> {
    const result = await this.portRegistry.execute<GisTriageResult>(
      'incident',
      'gis-triage',
      {
        ticketIds: command.ticketIds,
        area: command.area,
        useCache: false,
      },
    );
    if (!result?.data) throw new PortFallbackException('incident');
    return result.data;
  }
}
