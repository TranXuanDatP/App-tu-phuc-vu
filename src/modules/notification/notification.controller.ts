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
import { CurrentUser } from '@modules/auth/infrastructure/decorators/current-user.decorator';
import { RequiresBinding } from '../binding/decorators/requires-binding.decorator';
import { NotificationService } from './notification.service';

@ApiTags('Notifications')
@ApiBearerAuth('JWT-auth')
@RequiresBinding()
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get('preferences')
  @ApiOperation({ summary: 'Get notification preferences' })
  getPreferences(@CurrentUser('id') userId: string) {
    return this.notificationService.getPreferences(userId);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Update notification preferences' })
  updatePreferences(@CurrentUser('id') userId: string, @Body() body: unknown) {
    return this.notificationService.updatePreferences(userId, body);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get notification history' })
  getHistory(@CurrentUser('id') userId: string, @Query() query: Record<string, unknown>) {
    return this.notificationService.getHistory(userId, query);
  }

  @Get('cutoff-schedule/:areaId')
  @ApiOperation({ summary: 'Get water cutoff schedule for an area' })
  getCutoffSchedule(@Param('areaId') areaId: string) {
    return this.notificationService.getCutoffSchedule(areaId);
  }
}

@ApiTags('Proactive Alerts')
@ApiBearerAuth('JWT-auth')
@RequiresBinding()
@Controller('proactive-notifications')
export class ProactiveNotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get('active')
  @ApiOperation({ summary: 'Get active alerts for customer area' })
  getActiveAlerts(@CurrentUser('id') userId: string) {
    return this.notificationService.getActiveAlerts(userId);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get alert history' })
  getAlertHistory(@CurrentUser('id') userId: string, @Query() query: Record<string, unknown>) {
    return this.notificationService.getAlertHistory(userId, query);
  }

  @Post(':alertId/acknowledge')
  @ApiOperation({ summary: 'Acknowledge an alert' })
  acknowledgeAlert(
    @CurrentUser('id') userId: string,
    @Param() params: Record<string, string>,
  ) {
    return this.notificationService.acknowledgeAlert(params.alertId, userId);
  }
}
