/**
 * Proactive Notification DTOs — Zod Schemas + TypeScript Types
 *
 * AC#1: Active Alerts (FR50, FR51)
 * AC#2: Alert History (FR52)
 * AC#3: Acknowledge Alert (FR53)
 * AC#4: Dynamic cache tier (5-15 min)
 * (Moved from modules/communication — BFF owns no business data, DTOs are port contracts.)
 */

import { z } from 'zod';

// =============================================================================
// AC#1: Active Alerts
// =============================================================================

export const AlertTypeSchema = z.enum(['outage', 'maintenance', 'quality']);

export const AlertStatusSchema = z.enum(['active', 'resolved', 'scheduled']);

export const ActiveAlertSchema = z.object({
  id: z.string().min(1),
  type: AlertTypeSchema,
  description: z.string().min(1),
  affectedArea: z.string().min(1),
  expectedStartTime: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  expectedEndTime: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  status: AlertStatusSchema,
  severity: z.enum(['low', 'medium', 'high']).optional(),
});

export const GetActiveAlertsResponseSchema = z.object({
  alerts: z.array(ActiveAlertSchema),
  totalCount: z.number(),
});

// =============================================================================
// AC#2: Alert History
// =============================================================================

export const AlertHistoryItemSchema = z.object({
  id: z.string().min(1),
  type: AlertTypeSchema,
  description: z.string().min(1),
  affectedArea: z.string().min(1),
  startTime: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  endTime: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  status: AlertStatusSchema,
  resolvedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/).nullable(),
});

export const AlertHistoryQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(20),
});

export const AlertHistoryResponseSchema = z.object({
  alerts: z.array(AlertHistoryItemSchema),
  totalCount: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

// =============================================================================
// AC#3: Acknowledge Alert
// =============================================================================

export const AcknowledgeAlertResponseSchema = z.object({
  alertId: z.string().min(1),
  customerId: z.string().min(1),
  acknowledgedAt: z.string(),
});

// =============================================================================
// Shared Validation
// =============================================================================

export const AlertIdParamSchema = z.object({
  alertId: z.string().min(1).regex(/^[a-zA-Z0-9-_]+$/),
});

// =============================================================================
// TypeScript Types
// =============================================================================

export type AlertType = z.infer<typeof AlertTypeSchema>;
export type AlertStatus = z.infer<typeof AlertStatusSchema>;
export type ActiveAlert = z.infer<typeof ActiveAlertSchema>;
export type GetActiveAlertsResponse = z.infer<typeof GetActiveAlertsResponseSchema>;
export type AlertHistoryItem = z.infer<typeof AlertHistoryItemSchema>;
export type AlertHistoryQuery = z.infer<typeof AlertHistoryQuerySchema>;
export type AlertHistoryResponse = z.infer<typeof AlertHistoryResponseSchema>;
export type AcknowledgeAlertResponse = z.infer<typeof AcknowledgeAlertResponseSchema>;
