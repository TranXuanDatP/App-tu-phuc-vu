/**
 * Account service — lean BFF orchestrator over the customer-profile and
 * onboarding ports. Thin pass-through to PortRegistry; no business logic.
 * Methods are the former CQRS handlers' execute() bodies:
 *  - customer-profile: get-profile, get-timeline, get-related-accounts, update-profile
 *  - onboarding: create-onboarding-request, get-onboarding-status, submit-documents
 */
import { Injectable } from '@nestjs/common';
import { PortRegistry } from '@shared/port';
import { ValidationException } from '@core/common';
import { UpdateProfileSchema } from './dto/update-profile.dto';
import {
  CreateOnboardingRequestSchema,
  SubmitDocumentsRequestSchema,
} from './dto/onboarding.dto';
import type {
  CustomerProfileResponse,
  TimelineResponse,
  RelatedAccountsResponse,
} from './dto/customer-profile.dto';
import type {
  OnboardingStatus,
  CreateOnboardingResult,
  SubmitDocumentsResult,
} from './dto/onboarding.dto';

@Injectable()
export class AccountService {
  constructor(private readonly portRegistry: PortRegistry) {}

  async getProfile(customerId: string): Promise<CustomerProfileResponse> {
    const result = await this.portRegistry.execute<CustomerProfileResponse>(
      'customer-profile',
      'get-profile',
      { customerId },
    );
    return result.data;
  }

  async getTimeline(
    customerId: string,
    filters?: Record<string, unknown>,
  ): Promise<TimelineResponse> {
    const result = await this.portRegistry.execute<TimelineResponse>(
      'customer-profile',
      'get-timeline',
      { customerId, filters },
    );
    return result.data;
  }

  async getRelatedAccounts(customerId: string): Promise<RelatedAccountsResponse> {
    const result = await this.portRegistry.execute<RelatedAccountsResponse>(
      'customer-profile',
      'get-related-accounts',
      { customerId },
    );
    return result.data;
  }

  /** Validate → update downstream → re-fetch fresh profile. */
  async updateProfile(customerId: string, body: unknown): Promise<CustomerProfileResponse> {
    const parsed = UpdateProfileSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.message);
    }
    await this.portRegistry.execute('customer-profile', 'update-profile', {
      customerId,
      data: parsed.data,
    });
    const fresh = await this.portRegistry.execute<CustomerProfileResponse>(
      'customer-profile',
      'get-profile',
      { customerId },
    );
    return fresh.data;
  }

  // ── Onboarding (new connection signup) ─────────────────────────────────────

  /** Validate → create onboarding request. */
  async createOnboardingRequest(
    customerId: string,
    body: unknown,
  ): Promise<CreateOnboardingResult> {
    const parsed = CreateOnboardingRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.message);
    }
    const result = await this.portRegistry.execute<CreateOnboardingResult>(
      'onboarding',
      'create-onboarding-request',
      { customerId, ...parsed.data, useCache: false },
    );
    return result.data;
  }

  async getOnboardingStatus(requestId: string): Promise<OnboardingStatus> {
    const result = await this.portRegistry.execute<OnboardingStatus>(
      'onboarding',
      'get-onboarding-status',
      { requestId },
    );
    return result.data;
  }

  /** Validate → submit documents for an onboarding request. */
  async submitDocuments(
    requestId: string,
    customerId: string,
    body: unknown,
  ): Promise<SubmitDocumentsResult> {
    const parsed = SubmitDocumentsRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.message);
    }
    const result = await this.portRegistry.execute<SubmitDocumentsResult>(
      'onboarding',
      'submit-documents',
      { requestId, customerId, documents: parsed.data.documents, useCache: false },
    );
    return result.data;
  }
}
