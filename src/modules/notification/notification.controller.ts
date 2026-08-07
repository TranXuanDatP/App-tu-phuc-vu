/**
 * Notification controllers — REST endpoints for notification preferences/history,
 * proactive area alerts, and the migrated water-cutoff schedule. Thin: route +
 * auth → delegates to NotificationService. Input validation lives in the service
 * (see notification.service.spec.ts).
 *
 * Route prefixes preserved exactly: 'notifications', 'proactive-notifications'.
 *
 * ⚠️ Route ordering: GET /preferences, GET /history, GET /active MUST come BEFORE
 * any @Post(':alertId/...') dynamic routes — NestJS matches top-down.
 *
 * @Controller('notifications') also exposes the migrated GET /cutoff-schedule/:areaId
 * (the customer app reads cutoff alerts via the notification module now).
 */
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CustomerId } from '../binding/decorators/current-customer.decorator';
import { NotificationService } from './notification.service';

@ApiTags('Notifications')
@ApiBearerAuth('JWT-auth')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get('preferences')
  @ApiOperation({ summary: 'Get notification preferences' })
  getPreferences(@CustomerId() customerId: string) {
    return this.notificationService.getPreferences(customerId);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Update notification preferences' })
  updatePreferences(@CustomerId() customerId: string, @Body() body: unknown) {
    return this.notificationService.updatePreferences(customerId, body);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get notification history' })
  getHistory(@CustomerId() customerId: string, @Query() query: Record<string, unknown>) {
    return this.notificationService.getHistory(customerId, query);
  }

  @Get('cutoff-schedule/:areaId')
  @ApiOperation({ summary: 'Get water cutoff schedule for an area' })
  getCutoffSchedule(@Param('areaId') areaId: string) {
    return this.notificationService.getCutoffSchedule(areaId);
  }
}

@ApiTags('Proactive Alerts')
@ApiBearerAuth('JWT-auth')
@Controller('proactive-notifications')
export class ProactiveNotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get('active')
  @ApiOperation({ summary: 'Get active alerts for customer area' })
  getActiveAlerts(@CustomerId() customerId: string) {
    return this.notificationService.getActiveAlerts(customerId);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get alert history' })
  getAlertHistory(@CustomerId() customerId: string, @Query() query: Record<string, unknown>) {
    return this.notificationService.getAlertHistory(customerId, query);
  }

  @Post(':alertId/acknowledge')
  @ApiOperation({ summary: 'Acknowledge an alert' })
  acknowledgeAlert(
    @CustomerId() customerId: string,
    @Param() params: Record<string, string>,
  ) {
    return this.notificationService.acknowledgeAlert(params.alertId, customerId);
  }
}
