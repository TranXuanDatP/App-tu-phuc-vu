import { Global, Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  LoggingModule,
  HealthModule,
  DrizzleDatabaseModule,
  schema,
  ContextModule,
  CorrelationIdMiddleware,
} from 'src/libs/shared';
import { PortModule } from 'src/libs/shared/port';
import { AuthPropagationModule, AuthPropagationMiddleware } from 'src/libs/shared/auth-propagation';
import { AuthModule } from 'src/modules/auth/auth.module';
import { BindingModule } from 'src/modules/binding/binding.module';
import { AccountModule } from 'src/modules/account/account.module';
import { ServiceRequestModule } from 'src/modules/service-request/service-request.module';
import { UsageModule } from 'src/modules/usage/usage.module';
import { BillingModule } from 'src/modules/billing/billing.module';
import { PaymentModule } from 'src/modules/payment/payment.module';
import { NotificationModule } from 'src/modules/notification/notification.module';
import { SessionModule } from 'src/modules/session/session.module';
import { SupportModule } from 'src/modules/support/support.module';
import { ReportModule } from 'src/modules/report/report.module';

@Global()
@Module({
  imports: [
    // Configuration (loads .env)
    ConfigModule.forRoot({ isGlobal: true }),
    // Structured Logging with Pino
    LoggingModule,
    // Request Context with Correlation ID for distributed tracing
    ContextModule,
    // Drizzle Database with application schema
    DrizzleDatabaseModule.forRoot({
      schema,
    }),
    // Health check endpoints
    HealthModule,
    // Auth Module — better-auth (customer identity, OTP, sessions)
    AuthModule,
    // Binding Module — customer binding proof + BindingVerifiedGuard (global APP_GUARD)
    BindingModule,
    // Account Module — customer 360° profile, timeline, related accounts (lean BFF; was customer)
    AccountModule,
    // Service-Request Module — contracts + e-contracts (lean BFF; was contract+econtract)
    ServiceRequestModule,
    // Usage Module — consumption, meter readings, calibration (lean BFF; was meter)
    UsageModule,
    // Billing Module — tariff plan, breakdown, applicable fees, invoices
    BillingModule,
    // Payment Module — payment initiation, history, debt, webhook
    PaymentModule,
    // Notification Module — alerts, notifications, cutoff schedule (lean BFF; was communication)
    NotificationModule,
    // Session Module — atomic Redis session store & event recording (folds into auth P3.2)
    SessionModule,
    // Support Module — click-to-call + call history (lean BFF; was call-center)
    SupportModule,
    // Report Module — incident reporting + tracking (lean BFF; was incident)
    ReportModule,
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
