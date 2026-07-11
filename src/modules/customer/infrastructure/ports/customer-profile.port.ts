/**
 * Customer Profile Port Interface & Mock Adapter
 *
 * Defines the contract for downstream customer profile service communication.
 * MockCustomerProfileAdapter returns mock data during development.
 *
 * AC: #1 (getProfile), #2 (getTimeline), #3 (updateProfile), #4 (getRelatedAccounts)
 */

import { Injectable, Logger } from '@nestjs/common';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import { IPortAdapter } from '@shared/port/port.interface';
import {
  CustomerProfileSchema,
  TimelineResponseSchema,
  RelatedAccountsResponseSchema,
  UpdateProfileResponseSchema,
} from '../../application/dtos/customer-profile.dto';

/**
 * Customer Profile Port Interface
 *
 * Methods: get-profile, get-timeline, update-profile, get-related-accounts
 * Each method is dispatched via PortRegistry.execute('customer-profile', method, params).
 */
export interface ICustomerProfilePort extends IPortAdapter {
  // Methods are invoked via execute(method, params) from IPortAdapter
}

/**
 * Mock Customer Profile Adapter
 *
 * Returns mock customer profile responses from JSON files for development.
 * Extends MockAdapterBase for consistent mock behavior.
 */
@Injectable()
export class MockCustomerProfileAdapter extends MockAdapterBase implements ICustomerProfilePort {
  constructor() {
    super(
      'customer-profile',
      {
        'get-profile': CustomerProfileSchema,
        'get-timeline': TimelineResponseSchema,
        'get-related-accounts': RelatedAccountsResponseSchema,
        'update-profile': UpdateProfileResponseSchema,
        'find-by-phone': CustomerProfileSchema,
      },
      new Logger('customer-profile-mock-adapter'),
    );
  }
}
