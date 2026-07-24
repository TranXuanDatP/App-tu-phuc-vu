/**
 * Usage module — lean BFF module (4-part: controller + service + dto + clients).
 * Registers the meter + meter-reading + smart-meter mock ports. No domain/,
 * no CQRS handlers.
 *
 * Three ports:
 *   - meter (static, 12-24h cache) — meter info, calibration, history
 *   - meter-reading (dynamic, 5-15 min cache) — consumption, comparison, detail
 *   - smart-meter (real-time) — live consumption flow + device status
 *
 * Two controllers share UsageService:
 *   - UsageController (/meters)
 *   - SmartMeterController (/smart-meter)
 */
import { Module, OnModuleInit } from '@nestjs/common';
import { PortRegistry } from '@shared/port';
import { UsageController, SmartMeterController } from './usage.controller';
import { UsageService } from './usage.service';
import { MockMeterAdapter } from './clients/meter.client';
import { MockMeterReadingAdapter } from './clients/meter-reading.client';
import { MockSmartMeterAdapter } from './clients/smart-meter.client';

@Module({
  controllers: [UsageController, SmartMeterController],
  providers: [UsageService, MockMeterAdapter, MockMeterReadingAdapter, MockSmartMeterAdapter],
})
export class UsageModule implements OnModuleInit {
  constructor(
    private readonly portRegistry: PortRegistry,
    private readonly mockMeterAdapter: MockMeterAdapter,
    private readonly mockReadingAdapter: MockMeterReadingAdapter,
    private readonly mockSmartMeterAdapter: MockSmartMeterAdapter,
  ) {}

  onModuleInit() {
    // Port 1: meter info (static, 12-24h cache)
    this.portRegistry.register('meter', this.mockMeterAdapter, this.mockMeterAdapter);
    // Port 2: meter readings (dynamic, 5-15 min cache)
    this.portRegistry.register('meter-reading', this.mockReadingAdapter, this.mockReadingAdapter);
    // Port 3: smart meter (real-time consumption + device status)
    this.portRegistry.register('smart-meter', this.mockSmartMeterAdapter, this.mockSmartMeterAdapter);
  }
}
