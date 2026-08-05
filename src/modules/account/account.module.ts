/**
 * Account module — lean BFF module (4-part: controller + service + dto + clients).
 * Registers the customer-profile and onboarding mock ports. No domain/, no CQRS
 * handlers.
 */
import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PortRegistry } from '@shared/port';
import { AccountController, OnboardingController } from './account.controller';
import { AccountService } from './account.service';
import { MockCustomerProfileAdapter } from './clients/customer-profile.client';
import { CustomerProfileInternalAdapter } from './clients/customer-profile-live.client';
import { MockOnboardingAdapter } from './clients/onboarding.client';
import { CUSTOMER_SERVICE_CLIENT } from './clients/customer-service.client';
import { MockCustomerServiceClient } from './clients/customer-service-mock.client';

@Module({
  controllers: [AccountController, OnboardingController],
  providers: [
    AccountService,
    MockCustomerProfileAdapter,
    CustomerProfileInternalAdapter,
    MockOnboardingAdapter,
    // Customer-service client for the BINDING flow (resolve/verify/profile). Mock-first:
    // the real endpoints (SPEC-safe-wire §C) don't exist yet (team customer-service must
    // answer B5 — which secret verify supports). Flip to an HTTP client in this factory
    // when the contract goes live; the binding flow's injected interface is unchanged.
    {
      provide: CUSTOMER_SERVICE_CLIENT,
      useFactory: (configService: ConfigService) => {
        const url = configService.get<string>('CUSTOMER_SERVICE_URL');
        // A real http URL is set, but the binding resolve/verify/profile HTTP client is
        // not implemented yet — keep the mock so the feature stays testable. (resolve for
        // check-registration still has its own inline fetch — separate concern.)
        if (url && url !== 'mock://customer-service') {
          // eslint-disable-next-line no-console
          console.warn(
            `[binding] CUSTOMER_SERVICE_URL=${url} but binding resolve/verify/profile HTTP client not implemented — using mock. See SPEC-A4-A1 §A4.`,
          );
        }
        return new MockCustomerServiceClient();
      },
      inject: [ConfigService],
    },
  ],
  exports: [AccountService, CUSTOMER_SERVICE_CLIENT],
})
export class AccountModule implements OnModuleInit {
  constructor(
    private readonly portRegistry: PortRegistry,
    private readonly mockAdapter: MockCustomerProfileAdapter,
    private readonly liveAdapter: CustomerProfileInternalAdapter,
    private readonly onboardingAdapter: MockOnboardingAdapter,
  ) {}

  onModuleInit() {
    // mock = current default (api-endpoints.yaml `customer-profile.adapter: mock`).
    // live = CustomerProfileInternalAdapter — activates when that is flipped to
    // `live` (real customer-service ready). No code change needed to switch.
    this.portRegistry.register('customer-profile', this.mockAdapter, this.liveAdapter);
    this.portRegistry.register('onboarding', this.onboardingAdapter, this.onboardingAdapter);
  }
}
