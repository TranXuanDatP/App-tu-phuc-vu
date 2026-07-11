import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';
import { PortRegistry } from '@shared/port';
import { PortFallbackException } from '@shared/port/port-exceptions';
import { CreateReportCommand, CreateReportResultType } from '../create-report.command';
import type { CreateReportResult } from '../../dtos/incident.dto';

@CommandHandler(CreateReportCommand)
export class CreateReportHandler implements ICommandHandler<CreateReportCommand> {
  constructor(private readonly portRegistry: PortRegistry) {}

  async execute(command: CreateReportCommand): Promise<CreateReportResultType> {
    const result = await this.portRegistry.execute<CreateReportResult>(
      'incident',
      'create-report',
      {
        customerId: command.customerId,
        type: command.type,
        description: command.description,
        location: command.location,
        photoUrls: command.photoUrls,
        useCache: false,
      },
    );
    if (!result?.data) throw new PortFallbackException('incident');
    return result.data;
  }
}
