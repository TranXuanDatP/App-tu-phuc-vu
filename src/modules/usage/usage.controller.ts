/**
 * Usage controller — REST endpoints for meter/usage operations (route prefix
 * /meters preserved for FE contract). Thin: route + auth → delegates to
 * UsageService. Input validation lives in the service (see usage.service.spec.ts).
 */
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CustomerId } from '../binding/decorators/current-customer.decorator';
import { RequiresBinding } from '../binding/decorators/requires-binding.decorator';
import { UsageService } from './usage.service';

@ApiTags('Meter')
@ApiBearerAuth('JWT-auth')
@RequiresBinding()
@Controller('meters')
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  @Get()
  @ApiOperation({ summary: 'Get customer meters (list)' })
  getMeters(@CustomerId() customerId: string) {
    return this.usageService.getMeters(customerId);
  }

  @Get('consumption')
  @ApiOperation({ summary: 'Get 12-month consumption history for charts' })
  getConsumptionHistory(@CustomerId() customerId: string) {
    return this.usageService.getConsumptionHistory(customerId);
  }

  @Get('consumption/comparison')
  @ApiOperation({ summary: 'Compare consumption between two periods' })
  getConsumptionComparison(
    @CustomerId() customerId: string,
    @Query('current') current: string,
    @Query('previous') previous: string,
  ) {
    return this.usageService.getConsumptionComparison(customerId, current, previous);
  }

  @Get('consumption/:period')
  @ApiOperation({ summary: 'Get period reading detail with evidence photos' })
  getReadingDetail(
    @CustomerId() customerId: string,
    @Param('period') period: string,
  ) {
    return this.usageService.getReadingDetail(customerId, period);
  }

  @Get(':meterId/calibration')
  @ApiOperation({ summary: 'Get meter calibration status' })
  getCalibrationStatus(
    @CustomerId() customerId: string,
    @Param('meterId') meterId: string,
  ) {
    return this.usageService.getCalibrationStatus(customerId, meterId);
  }

  @Get(':meterId/history')
  @ApiOperation({ summary: 'Get meter replacement history' })
  getMeterHistory(
    @CustomerId() customerId: string,
    @Param('meterId') meterId: string,
  ) {
    return this.usageService.getMeterHistory(customerId, meterId);
  }
}

/**
 * Smart Meter controller — real-time consumption + device status (route prefix
 * /smart-meter preserved for FE contract). Thin: route + auth → delegates to
 * UsageService. Folded from the former smart-meter module.
 */
@ApiTags('Smart Meter')
@ApiBearerAuth('JWT-auth')
@RequiresBinding()
@Controller('smart-meter')
export class SmartMeterController {
  constructor(private readonly usageService: UsageService) {}

  @Get('consumption')
  @ApiOperation({ summary: 'Get real-time consumption (current flow + today volume)' })
  getRealtimeConsumption(@CustomerId() customerId: string) {
    return this.usageService.getRealtimeConsumption(customerId);
  }

  @Get(':meterId/status')
  @ApiOperation({ summary: 'Get smart meter device status (online + battery)' })
  getMeterStatus(@CustomerId() customerId: string, @Param('meterId') meterId: string) {
    return this.usageService.getMeterStatus(customerId, meterId);
  }
}
