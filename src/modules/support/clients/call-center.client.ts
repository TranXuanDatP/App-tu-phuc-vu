/**
 * Mock adapter for the call-center port (downstream Call Center service).
 * Reads mocks/call-center/<method>.json. Swap to a real InternalAdapterBase
 * subclass (passed as the 2nd arg of portRegistry.register) when the downstream
 * service is ready — flip config/api-endpoints.yaml `adapter: live`.
 */
import { Injectable, Logger } from '@nestjs/common';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import { ClickToCallResultSchema, CallHistorySchema } from '../dto/call-center.dto';

@Injectable()
export class MockCallCenterAdapter extends MockAdapterBase {
  constructor() {
    super(
      'call-center',
      {
        'create-click-to-call': ClickToCallResultSchema,
        'get-call-history': CallHistorySchema,
      },
      new Logger('call-center-mock-adapter'),
    );
  }
}
