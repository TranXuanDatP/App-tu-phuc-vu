/**
 * Notification service — lean BFF orchestrator over the notification +
 * proactive-notification ports (+ migrated water-cutoff schedule read).
 * Thin pass-through to PortRegistry; no business logic. Methods are the former
 * CQRS handlers' execute() bodies. Input validation (Zod safeParse →
 * ValidationException) lives here, mirroring the account BFF module.
 *
 * Ports / methods:
 *   notification           — get-notification-preferences, update-notification-preferences,
 *                            get-notification-history, dispatch-notification
 *   proactive-notification — get-active-alerts, get-alert-history, acknowledge-alert
 *   water-cutoff           — get-cutoff-schedule (migrated from the water-cutoff module;
 *                            the port is still registered by WaterCutoffModule for now)
 *
 * NOTE: dispatch-notification was previously a CQRS command handler with per-channel
 * rate limiting (RedisRateLimiterService) + critical fallback chain + session-event
 * recording. As a lean BFF pass-through it validates the payload then dispatches on the
 * configured channel — the rate-limit/fallback/session logic is intentionally dropped
 * (BFF owns no business logic).
 */
import { Injectable } from '@nestjs/common';
import { PortRegistry } from '@shared/port';
import { ValidationException } from '@core/common';
import { DispatchNotificationPayloadSchema } from './dto/notification.dto';
import {
  NotificationHistoryQuerySchema,
  UpdatePreferencesBodySchema,
} from './dto/notification-preferences.dto';
import { AlertHistoryQuerySchema, AlertIdParamSchema } from './dto/proactive-notification.dto';
import type { CutoffSchedule } from './dto/cutoff.dto';
import type { DispatchNotificationResult } from './dto/notification.dto';
import type {
  NotificationPreferencesResponse,
  NotificationHistoryResponse,
  UpdateNotificationPreferencesResponse,
} from './dto/notification-preferences.dto';
import type {
  GetActiveAlertsResponse,
  AlertHistoryResponse,
  AcknowledgeAlertResponse,
} from './dto/proactive-notification.dto';

@Injectable()
export class NotificationService {
  constructor(private readonly portRegistry: PortRegistry) {}

  // ── proactive-notification port (Proactive Alerts) ──────────────────────────

  async getActiveAlerts(customerId: string): Promise<GetActiveAlertsResponse> {
    const result = await this.portRegistry.execute<GetActiveAlertsResponse>(
      'proactive-notification',
      'get-active-alerts',
      { customerId },
    );
    return result.data;
  }

  async getAlertHistory(
    customerId: string,
    filters: Record<string, unknown> = {},
  ): Promise<AlertHistoryResponse> {
    const validated = AlertHistoryQuerySchema.safeParse(filters);
    if (!validated.success) {
      throw new ValidationException(validated.error.message);
    }
    const result = await this.portRegistry.execute<AlertHistoryResponse>(
      'proactive-notification',
      'get-alert-history',
      { customerId, ...validated.data },
    );
    return result.data;
  }

  async acknowledgeAlert(
    alertId: string,
    customerId: string,
  ): Promise<AcknowledgeAlertResponse> {
    const validated = AlertIdParamSchema.safeParse({ alertId });
    if (!validated.success) {
      throw new ValidationException(validated.error.message);
    }
    const result = await this.portRegistry.execute<AcknowledgeAlertResponse>(
      'proactive-notification',
      'acknowledge-alert',
      { alertId: validated.data.alertId, customerId, useCache: false },
    );
    return result.data;
  }

  // ── notification port (Preferences + History + Dispatch) ────────────────────

  async getPreferences(customerId: string): Promise<NotificationPreferencesResponse> {
    const result = await this.portRegistry.execute<NotificationPreferencesResponse>(
      'notification',
      'get-notification-preferences',
      { customerId },
    );
    return result.data;
  }

  async getHistory(
    customerId: string,
    filters: Record<string, unknown> = {},
  ): Promise<NotificationHistoryResponse> {
    const validated = NotificationHistoryQuerySchema.safeParse(filters);
    if (!validated.success) {
      throw new ValidationException(validated.error.message);
    }
    const result = await this.portRegistry.execute<NotificationHistoryResponse>(
      'notification',
      'get-notification-history',
      { customerId, ...validated.data },
    );
    return result.data;
  }

  async updatePreferences(
    customerId: string,
    body: unknown,
  ): Promise<UpdateNotificationPreferencesResponse> {
    const validated = UpdatePreferencesBodySchema.safeParse(body);
    if (!validated.success) {
      throw new ValidationException(validated.error.message);
    }
    const result = await this.portRegistry.execute<UpdateNotificationPreferencesResponse>(
      'notification',
      'update-notification-preferences',
      { customerId, channels: validated.data.channels, useCache: false },
    );
    return result.data;
  }

  /** Thin dispatch — validates payload then forwards to the notification port. */
  async dispatchNotification(payload: unknown): Promise<DispatchNotificationResult> {
    const validated = DispatchNotificationPayloadSchema.safeParse(payload);
    if (!validated.success) {
      throw new ValidationException(validated.error.message);
    }
    const result = await this.portRegistry.execute<DispatchNotificationResult>(
      'notification',
      'dispatch-notification',
      { ...validated.data, useCache: false },
    );
    return result.data;
  }

  // ── water-cutoff port (migrated cutoff-schedule read) ───────────────────────

  async getCutoffSchedule(areaId: string): Promise<CutoffSchedule> {
    const r = await this.portRegistry.execute<CutoffSchedule>(
      'water-cutoff',
      'get-cutoff-schedule',
      { areaId },
    );
    return r.data;
  }
}
