/**
 * Mock adapter for the meter-reading port (downstream Meter Reading service).
 * Reads mocks/meter-reading/<method>.json. Swap to a real InternalAdapterBase
 * subclass (passed as the 2nd arg of portRegistry.register) when the downstream
 * service is ready — flip config/api-endpoints.yaml `adapter: live`.
 *
 * Methods: get-readings, get-comparison, get-reading-detail
 */
import { Injectable, Logger } from '@nestjs/common';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import {
  ReadingsListResponseSchema,
  ComparisonRawSchema,
  ReadingDetailSchema,
} from '../dto/meter-reading.dto';

@Injectable()
export class MockMeterReadingAdapter extends MockAdapterBase {
  constructor() {
    super(
      'meter-reading',
      {
        'get-readings': ReadingsListResponseSchema,
        'get-comparison': ComparisonRawSchema,
        'get-reading-detail': ReadingDetailSchema,
      },
      new Logger('meter-reading-mock-adapter'),
    );
  }
}
