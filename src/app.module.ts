import { Global, Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  SharedCqrsModule,
  LoggingModule,
  HealthModule,
  DrizzleDatabaseModule,
  DrizzleUnitOfWork,
  UNIT_OF_WORK_TOKEN,
  OutboxModule,
  schema,
  ContextModule,
  CorrelationIdMiddleware,
} from 'src/libs/shared';
import { PortModule } from 'src/libs/shared/port';
import { AuthPropagationModule, AuthPropagationMiddleware } from 'src/libs/shared/auth-propagation';
import { AuthModule } from 'src/modules/auth/auth.module';
import { CustomerModule } from 'src/modules/customer/customer.module';
import { ContractModule } from 'src/modules/contract/contract.module';
import { MeterModule } from 'src/modules/meter/meter.module';
import { BillingModule } from 'src/modules/billing/billing.module';
import { PaymentModule } from 'src/modules/payment/payment.module';
import { DocumentModule } from 'src/modules/document/document.module';
import { CommunicationModule } from 'src/modules/communication/communication.module';
import { SessionModule } from 'src/modules/session/session.module';
import { SegmentationModule } from 'src/modules/segmentation/segmentation.module';
import { GisModule } from 'src/modules/gis/gis.module';
import { ReportingModule } from 'src/modules/reporting/reporting.module';
import { WaterCutoffModule } from 'src/modules/water-cutoff/water-cutoff.module';
import { SmartMeterModule } from 'src/modules/smart-meter/smart-meter.module';
import { FieldTeamModule } from 'src/modules/field-team/field-team.module';
import { CallCenterModule } from 'src/modules/call-center/call-center.module';
import { EcontractModule } from 'src/modules/econtract/econtract.module';
import { SiteSurveyModule } from 'src/modules/site-survey/site-survey.module';
import { OnboardingModule } from 'src/modules/onboarding/onboarding.module';
import { AiModule } from 'src/modules/ai/ai.module';
import { MeterAnomalyModule } from 'src/modules/meter-anomaly/meter-anomaly.module';
import { CampaignModule } from 'src/modules/campaign/campaign.module';
import { LeakageAlertModule } from 'src/modules/leakage-alert/leakage-alert.module';
import { WaterQualityModule } from 'src/modules/water-quality/water-quality.module';
import { IncidentModule } from 'src/modules/incident/incident.module';

@Global()
@Module({
  imports: [
    // Configuration (loads .env)
    ConfigModule.forRoot({ isGlobal: true }),
    // Structured Logging with Pino
    LoggingModule,
    // Request Context with Correlation ID for distributed tracing
    ContextModule,
    // DDD/CQRS Module - Global module
    SharedCqrsModule,
    // Drizzle Database with application schema
    DrizzleDatabaseModule.forRoot({
      schema,
      unitOfWorkProvider: {
        provide: UNIT_OF_WORK_TOKEN,
        useClass: DrizzleUnitOfWork,
      },
    }),
    // Transactional Outbox Pattern for reliable event publishing
    OutboxModule,
    // Health check endpoints
    HealthModule,
    // Auth Module — customer registration & multi-provider authentication
    AuthModule,
    // Customer Module — 360° profile, timeline, related accounts (AC: Epic 2)
    CustomerModule,
    // Contract Module — contract lookup, detail, versions, PDF (AC: Epic 2)
    ContractModule,
    // Meter Module — meter list, calibration status, replacement history (AC: Epic 2)
    MeterModule,
    // Billing Module — tariff plan, breakdown, applicable fees, invoices (AC: Epic 3)
    BillingModule,
    // Payment Module — payment initiation, QR generation (AC: Epic 4)
    PaymentModule,
    // Document Module — upload/download/list (owns the 'document' port; AC: Epic 5)
    DocumentModule,
    // Communication Module — proactive area alerts, notification dispatch (AC: Epic 6)
    CommunicationModule,
    // Session Module — atomic Redis session store & event recording (AC: Epic 7)
    SessionModule,
    // Segmentation Module — customer segmentation + campaign eligibility (Phase 2, S3)
    SegmentationModule,
    // GIS Module — coverage check + customer location (Phase 2, S30)
    GisModule,
    // Reporting Module — consumption + comparison reports (Phase 2, S23)
    ReportingModule,
    // Water Cutoff Module — non-payment cutoff status + schedule (Phase 2, S17)
    WaterCutoffModule,
    // Smart Meter Module — real-time consumption + device status (Phase 2, S18)
    SmartMeterModule,
    // Field Team Module — live ETA + location tracking (Phase 2, S31)
    FieldTeamModule,
    // Call Center Module — click-to-call + call history (Phase 2, S29)
    CallCenterModule,
    // e-Contract Module — digital contract retrieval + e-signature (Phase 2, S15)
    EcontractModule,
    // Site Survey Module — on-site survey for new connection (Phase 2, onboarding)
    SiteSurveyModule,
    // Onboarding Module — new connection signup workflow (Phase 2, S5)
    OnboardingModule,
    // AI Module — chatbot assistant (Phase 2/3, S24)
    AiModule,
    // Meter Anomaly Module — AI meter-anomaly alerts (Phase 3, S27)
    MeterAnomalyModule,
    // Campaign Module — active marketing campaigns (Phase 3, S33)
    CampaignModule,
    // Leakage Alert Module — AI water-leakage detection (Phase 3, S25)
    LeakageAlertModule,
    // Water Quality Module — quality at location + alerts (Phase 3, S35)
    WaterQualityModule,
    // Incident Module — operational incidents + GIS Triage (Ticket ≠ Incident)
    IncidentModule,
    // Auth Propagation — JWT signing for BFF→downstream identity propagation
    AuthPropagationModule,
    // Hexagonal Port Registry — centralized downstream service interface (needs AuthPropagationModule)
    PortModule,
  ],
  providers: [
    // CACHE_SERVICE_TOKEN now provided by PortModule (which is @Global)
  ],
})
export class AppModule implements NestModule {
  /**
   * Configure global middleware
   *
   * CorrelationIdMiddleware:
   * - Extracts/generates correlation ID from request headers
   * - Sets up request context (correlationId, userId, tenantId)
   * - Adds correlation ID to response headers
   * - Enables distributed tracing across services
   */
  configure(consumer: MiddlewareConsumer) {
    // Order matters: CorrelationId first (creates context), then AuthPropagation (enriches context)
    consumer
      .apply(CorrelationIdMiddleware)
      .forRoutes('*');
    consumer
      .apply(AuthPropagationMiddleware)
      .exclude('api/auth', 'health', 'webhooks')
      .forRoutes('*');
  }
}
