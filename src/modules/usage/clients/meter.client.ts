/**
 * Mock adapter for the meter port (downstream Meter service).
 * Reads mocks/meter/<method>.json. Swap to a real InternalAdapterBase
 * subclass (passed as the 2nd arg of portRegistry.register) when the downstream
 * service is ready — flip config/api-endpoints.yaml `adapter: live`.
 *
 * Methods: get-meter-by-customer, get-calibration-status, get-meter-history
 */
import { Injectable, Logger } from '@nestjs/common';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import {
  MeterListResponseSchema,
  CalibrationStatusRawSchema,
  MeterHistoryResponseSchema,
} from '../dto/meter.dto';

@Injectable()
export class MockMeterAdapter extends MockAdapterBase {
  constructor() {
    super(
      'meter',
      {
        'get-meter-by-customer': MeterListResponseSchema,
        'get-calibration-status': CalibrationStatusRawSchema,
        'get-meter-history': MeterHistoryResponseSchema,
      },
      new Logger('meter-mock-adapter'),
    );
  }
}
