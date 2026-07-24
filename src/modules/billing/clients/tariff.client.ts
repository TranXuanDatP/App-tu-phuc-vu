/**
 * Mock adapter for the tariff port (downstream Tariff/Billing service).
 * Reads mocks/tariff/<method>.json. Swap to a real InternalAdapterBase
 * subclass (passed as the 2nd arg of portRegistry.register) when the downstream
 * service is ready — flip config/api-endpoints.yaml `adapter: live`.
 *
 * Methods: get-tariff-plan, get-tariff-breakdown, get-applicable-fees
 */
import { Injectable, Logger } from '@nestjs/common';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import {
  TariffPlanSchema,
  TariffBreakdownSchema,
  ApplicableFeesResponseSchema,
} from '../dto/tariff.dto';

@Injectable()
export class MockTariffAdapter extends MockAdapterBase {
  constructor() {
    super(
      'tariff',
      {
        'get-tariff-plan': TariffPlanSchema,
        'get-tariff-breakdown': TariffBreakdownSchema,
        'get-applicable-fees': ApplicableFeesResponseSchema,
      },
      new Logger('tariff-mock-adapter'),
    );
  }
}
