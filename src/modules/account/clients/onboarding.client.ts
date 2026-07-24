/**
 * Mock adapter for the onboarding port (downstream Onboarding/Connection
 * signup service). Reads mocks/onboarding/<method>.json. Swap to a real
 * InternalAdapterBase subclass (passed as the 2nd arg of
 * portRegistry.register) when the downstream service is ready — flip
 * config/api-endpoints.yaml `adapter: live`.
 */
import { Injectable, Logger } from '@nestjs/common';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import {
  OnboardingStatusSchema,
  CreateOnboardingResultSchema,
  SubmitDocumentsResultSchema,
} from '../dto/onboarding.dto';

@Injectable()
export class MockOnboardingAdapter extends MockAdapterBase {
  constructor() {
    super(
      'onboarding',
      {
        'create-onboarding-request': CreateOnboardingResultSchema,
        'get-onboarding-status': OnboardingStatusSchema,
        'submit-documents': SubmitDocumentsResultSchema,
      },
      new Logger('onboarding-mock-adapter'),
    );
  }
}
