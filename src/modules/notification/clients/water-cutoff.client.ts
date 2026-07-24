import { Injectable, Logger } from '@nestjs/common';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import { CutoffStatusSchema, CutoffScheduleSchema } from '../dto/cutoff.dto';

/**
 * Mock adapter for the `water-cutoff` port — migrated here from the deleted
 * water-cutoff module. The customer app reads cutoff schedules via notification
 * (the cutoff operation itself is ops-only). Reads mocks/water-cutoff/<method>.json.
 */
@Injectable()
export class MockWaterCutoffAdapter extends MockAdapterBase {
  constructor() {
    super(
      'water-cutoff',
      {
        'get-cutoff-status': CutoffStatusSchema,
        'get-cutoff-schedule': CutoffScheduleSchema,
      },
      new Logger('water-cutoff-mock-adapter'),
    );
  }
}
