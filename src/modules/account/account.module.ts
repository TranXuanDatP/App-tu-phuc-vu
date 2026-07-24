/**
 * Account module — lean BFF module (4-part: controller + service + dto + clients).
 * Registers the customer-profile and onboarding mock ports. No domain/, no CQRS
 * handlers.
 */
import { Module, OnModuleInit } from '@nestjs/common';
import { PortRegistry } from '@shared/port';
import { AccountController, OnboardingController } from './account.controller';
import { AccountService } from './account.service';
import { MockCustomerProfileAdapter } from './clients/customer-profile.client';
import { CustomerProfileInternalAdapter } from './clients/customer-profile-live.client';
import { MockOnboardingAdapter } from './clients/onboarding.client';

@Module({
  controllers: [AccountController, OnboardingController],
  providers: [AccountService, MockCustomerProfileAdapter, CustomerProfileInternalAdapter, MockOnboardingAdapter],
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
