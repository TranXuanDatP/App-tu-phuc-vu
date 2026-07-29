/**
 * Incident DTOs — Zod Schemas + TypeScript Types
 *
 * Port contracts for the 'incident' port (downstream incident-service).
 * BFF owns no business data; these are port contracts.
 * (Moved from modules/incident/application/dtos/incident.dto.ts.)
 */
import { z } from 'zod';

// ── Enums ────────────────────────────────────────────────────────────────────
export const IncidentTypeSchema = z.enum([
  'pipe_burst',    // vỡ ống
  'water_outage',  // mất nước
  'water_quality', // chất lượng nước
  'leak',          // rò rỉ
  'maintenance',   // bảo trì
  'other',         // khác
]);
export type IncidentType = z.infer<typeof IncidentTypeSchema>;

export const IncidentStatusSchema = z.enum([
  'reported', 'triaged', 'assigned', 'in_progress', 'resolved', 'closed',
]);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const IncidentSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type IncidentSeverity = z.infer<typeof IncidentSeveritySchema>;

export const IncidentSourceSchema = z.enum([
  'customer_report', // từ ticket KH qua GIS Triage
  'sensor',          // từ cảm biến IoT
  'staff_report',    // nhân viên báo
  'gis_triage',      // GIS Triage gộp từ nhiều ticket
]);
export type IncidentSource = z.infer<typeof IncidentSourceSchema>;

// ── Location ─────────────────────────────────────────────────────────────────
export const IncidentLocationSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  address: z.string(),
  area: z.string().nullable(),
});
export type IncidentLocation = z.infer<typeof IncidentLocationSchema>;

// ── Timeline ─────────────────────────────────────────────────────────────────
export const IncidentTimelineEntrySchema = z.object({
  status: IncidentStatusSchema,
  timestamp: z.string(),
  actor: z.string(),
  description: z.string(),
});
export type IncidentTimelineEntry = z.infer<typeof IncidentTimelineEntrySchema>;

// ── Incident (summary) ───────────────────────────────────────────────────────
export const IncidentSchema = z.object({
  incidentId: z.string(),
  type: IncidentTypeSchema,
  status: IncidentStatusSchema,
  severity: IncidentSeveritySchema,
  location: IncidentLocationSchema,
  description: z.string(),
  affectedCustomers: z.number().int(),
  linkedTicketIds: z.array(z.string()),
  assignedTeam: z.string().nullable(),
  source: IncidentSourceSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type Incident = z.infer<typeof IncidentSchema>;

// ── Incident detail (with timeline) ──────────────────────────────────────────
export const IncidentDetailSchema = IncidentSchema.extend({
  timeline: z.array(IncidentTimelineEntrySchema),
});
export type IncidentDetail = z.infer<typeof IncidentDetailSchema>;

// ── Responses ────────────────────────────────────────────────────────────────
export const IncidentListResponseSchema = z.object({
  incidents: z.array(IncidentSchema),
  totalCount: z.number().int(),
});
export type IncidentListResponse = z.infer<typeof IncidentListResponseSchema>;

export const CreateIncidentRequestSchema = z.object({
  type: IncidentTypeSchema,
  severity: IncidentSeveritySchema,
  location: IncidentLocationSchema,
  description: z.string(),
  source: IncidentSourceSchema,
  linkedTicketIds: z.array(z.string()).optional(),
});
export type CreateIncidentRequest = z.infer<typeof CreateIncidentRequestSchema>;

export const CreateIncidentResultSchema = z.object({
  incidentId: z.string(),
  status: IncidentStatusSchema,
  createdAt: z.string(),
});
export type CreateIncidentResult = z.infer<typeof CreateIncidentResultSchema>;

// ── Update status (request + result) ─────────────────────────────────────────
export const UpdateIncidentStatusRequestSchema = z.object({
  status: IncidentStatusSchema,
  actor: z.string().optional(),
  description: z.string().optional(),
});
export type UpdateIncidentStatusRequest = z.infer<typeof UpdateIncidentStatusRequestSchema>;

export const UpdateIncidentStatusResultSchema = z.object({
  incidentId: z.string(),
  status: IncidentStatusSchema,
  updatedAt: z.string(),
});
export type UpdateIncidentStatusResult = z.infer<typeof UpdateIncidentStatusResultSchema>;

// ── GIS Triage ───────────────────────────────────────────────────────────────
export const GisTriageRequestSchema = z.object({
  ticketIds: z.array(z.string()),
  area: z.string().optional(),
});
export type GisTriageRequest = z.infer<typeof GisTriageRequestSchema>;

export const GisTriageResultSchema = z.object({
  incidentId: z.string(),
  incidentType: IncidentTypeSchema,
  severity: IncidentSeveritySchema,
  groupedTicketIds: z.array(z.string()),
  location: IncidentLocationSchema,
  message: z.string(),
});
export type GisTriageResult = z.infer<typeof GisTriageResultSchema>;

// ── Phản ánh (per-customer report in Sự cố context) ──────────────────────────
// Replaces "ticket" in the customer app. KH báo sự cố → tạo phản ánh (#SC-...)
// → GIS Triage gộp → Incident. KH theo dõi phản ánh của mình.
export const IncidentReportSchema = z.object({
  reportId: z.string(),
  customerId: z.string(),
  type: IncidentTypeSchema,
  description: z.string(),
  photoUrls: z.array(z.string()),
  location: IncidentLocationSchema,
  status: IncidentStatusSchema,
  incidentId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IncidentReport = z.infer<typeof IncidentReportSchema>;

export const IncidentReportListResponseSchema = z.object({
  reports: z.array(IncidentReportSchema),
  totalCount: z.number().int(),
});
export type IncidentReportListResponse = z.infer<typeof IncidentReportListResponseSchema>;

export const CreateReportRequestSchema = z.object({
  // Wire-service: accept any type string from the customer app (low_pressure,
  // meter_issue, etc.) — the downstream incident-service normalises/triages.
  type: z.string().min(1),
  description: z.string(),
  photoUrls: z.array(z.string()).optional(),
  location: IncidentLocationSchema,
});
export type CreateReportRequest = z.infer<typeof CreateReportRequestSchema>;

export const CreateReportResultSchema = z.object({
  reportId: z.string(),
  status: IncidentStatusSchema,
  incidentId: z.string().nullable(),
  message: z.string(),
});
export type CreateReportResult = z.infer<typeof CreateReportResultSchema>;

export const ReportDetailSchema = IncidentReportSchema.extend({
  incidentSummary: z.object({
    incidentId: z.string(),
    type: IncidentTypeSchema,
    status: IncidentStatusSchema,
    severity: IncidentSeveritySchema,
    affectedCustomers: z.number().int(),
    assignedTeam: z.string().nullable(),
  }).nullable(),
});
export type ReportDetail = z.infer<typeof ReportDetailSchema>;
