/**
 * Usage controller — REST endpoints for meter/usage operations (route prefix
 * /meters preserved for FE contract). Thin: route + auth → delegates to
 * UsageService. Input validation lives in the service (see usage.service.spec.ts).
 */
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/infrastructure/decorators/current-user.decorator';
import { UsageService } from './usage.service';

@ApiTags('Meter')
@ApiBearerAuth('JWT-auth')
@Controller('meters')
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  @Get()
  @ApiOperation({ summary: 'Get customer meters (list)' })
  getMeters(@CurrentUser('id') userId: string) {
    return this.usageService.getMeters(userId);
  }

  @Get('consumption')
  @ApiOperation({ summary: 'Get 12-month consumption history for charts' })
  getConsumptionHistory(@CurrentUser('id') userId: string) {
    return this.usageService.getConsumptionHistory(userId);
  }

  @Get('consumption/comparison')
  @ApiOperation({ summary: 'Compare consumption between two periods' })
  getConsumptionComparison(
    @CurrentUser('id') userId: string,
    @Query('current') current: string,
    @Query('previous') previous: string,
  ) {
    return this.usageService.getConsumptionComparison(userId, current, previous);
  }

  @Get('consumption/:period')
  @ApiOperation({ summary: 'Get period reading detail with evidence photos' })
  getReadingDetail(
    @CurrentUser('id') userId: string,
    @Param('period') period: string,
  ) {
    return this.usageService.getReadingDetail(userId, period);
  }

  @Get(':meterId/calibration')
  @ApiOperation({ summary: 'Get meter calibration status' })
  getCalibrationStatus(
    @CurrentUser('id') userId: string,
    @Param('meterId') meterId: string,
  ) {
    return this.usageService.getCalibrationStatus(userId, meterId);
  }

  @Get(':meterId/history')
  @ApiOperation({ summary: 'Get meter replacement history' })
  getMeterHistory(
    @CurrentUser('id') userId: string,
    @Param('meterId') meterId: string,
  ) {
    return this.usageService.getMeterHistory(userId, meterId);
  }
}

/**
 * Smart Meter controller — real-time consumption + device status (route prefix
 * /smart-meter preserved for FE contract). Thin: route + auth → delegates to
 * UsageService. Folded from the former smart-meter module.
 */
@ApiTags('Smart Meter')
@ApiBearerAuth('JWT-auth')
@Controller('smart-meter')
export class SmartMeterController {
  constructor(private readonly usageService: UsageService) {}

  @Get('consumption')
  @ApiOperation({ summary: 'Get real-time consumption (current flow + today volume)' })
  getRealtimeConsumption(@CurrentUser('id') userId: string) {
    return this.usageService.getRealtimeConsumption(userId);
  }

  @Get(':meterId/status')
  @ApiOperation({ summary: 'Get smart meter device status (online + battery)' })
  getMeterStatus(@Param('meterId') meterId: string) {
    return this.usageService.getMeterStatus(meterId);
  }
}
