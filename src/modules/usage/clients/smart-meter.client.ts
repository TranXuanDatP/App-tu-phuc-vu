/**
 * Mock adapter for the smart-meter port (downstream Smart Meter service).
 * Reads mocks/smart-meter/<method>.json. Swap to a real InternalAdapterBase
 * subclass (passed as the 2nd arg of portRegistry.register) when the downstream
 * service is ready — flip config/api-endpoints.yaml `adapter: live`.
 *
 * Methods: get-realtime-consumption, get-meter-status
 */
import { Injectable, Logger } from '@nestjs/common';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import { RealtimeConsumptionSchema, SmartMeterStatusSchema } from '../dto/smart-meter.dto';

@Injectable()
export class MockSmartMeterAdapter extends MockAdapterBase {
  constructor() {
    super(
      'smart-meter',
      {
        'get-realtime-consumption': RealtimeConsumptionSchema,
        'get-meter-status': SmartMeterStatusSchema,
      },
      new Logger('smart-meter-mock-adapter'),
    );
  }
}
