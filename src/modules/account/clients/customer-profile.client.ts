/**
 * Mock adapter for the customer-profile port (downstream Account/Customer service).
 *
 * Mock-first + STATEFUL: customers created via `create-customer` are kept in an
 * in-memory Map (the mock Customer 360 stand-in) and served back by `get-profile` /
 * `find-by-phone` so the app registration flow works end-to-end within a session.
 * Reads for any other customerId fall back to the JSON fixtures (super.execute).
 *
 * The store resets on process restart — acceptable for dev. When the real
 * Customer 360 service is ready, replace this adapter with an InternalAdapterBase
 * subclass (passed as the 2nd arg of portRegistry.register) — the `create-customer`
 * port method becomes an HTTP POST, zero endpoint change. Flip
 * config/api-endpoints.yaml `adapter: live`.
 */
import { Injectable, Logger } from '@nestjs/common';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import {
  CustomerProfileSchema,
  CreateCustomerRequestSchema,
  TimelineResponseSchema,
  RelatedAccountsResponseSchema,
  UpdateProfileResponseSchema,
} from '../dto/customer-profile.dto';
import type { CustomerProfileResponse } from '../dto/customer-profile.dto';

// Module-level counter for generated customer IDs (APP-NNNNNN). Stable across
// adapter instances within a process.
let appCustomerCounter = 0;

// Normalized phone of the ONE pre-seeded "existing customer" (the find-by-phone
// fixture, customerId QN-0912345). Login with this phone → recognized as an
// existing customer (dashboard full); any other phone → no match → the app
// shows the "Bạn chưa đăng ký tài khoản" screen. App-registered customers (via
// create-customer) also match through phoneIndex.
const EXISTING_CUSTOMER_PHONE = '987654321';

@Injectable()
export class MockCustomerProfileAdapter extends MockAdapterBase {
  /** customerId → record, for customers created via create-customer. */
  private readonly createdCustomers = new Map<string, CustomerProfileResponse>();
  /** normalized phone → customerId, so find-by-phone resolves app-registered customers. */
  private readonly phoneIndex = new Map<string, string>();

  constructor() {
    super(
      'customer-profile',
      {
        'get-profile': CustomerProfileSchema,
        'get-timeline': TimelineResponseSchema,
        'get-related-accounts': RelatedAccountsResponseSchema,
        'update-profile': UpdateProfileResponseSchema,
        'find-by-phone': CustomerProfileSchema,
        'create-customer': CreateCustomerRequestSchema,
      },
      new Logger('customer-profile-mock-adapter'),
    );
  }

  override async execute(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (method === 'create-customer') {
      return this.createCustomer(params);
    }

    // Serve app-registered customers first; fall back to fixtures for seed data.
    if (method === 'get-profile') {
      const byId = params.customerId as string | undefined;
      if (byId && this.createdCustomers.has(byId)) {
        return this.createdCustomers.get(byId);
      }
    }
    if (method === 'find-by-phone') {
      const phone = params.phone as string | undefined;
      if (phone) {
        const norm = this.normalizePhone(phone);
        const id = this.phoneIndex.get(norm);
        if (id) return this.createdCustomers.get(id);
        // One pre-seeded "existing customer" (the fixture) so the matched /
        // existing-customer login branch is testable. Any OTHER phone → no
        // match → "Bạn chưa đăng ký tài khoản".
        if (norm === EXISTING_CUSTOMER_PHONE) return super.execute(method, params);
      }
      return null;
    }

    return super.execute(method, params);
  }

  private createCustomer(params: Record<string, unknown>): CustomerProfileResponse {
    const parsed = CreateCustomerRequestSchema.safeParse(params);
    if (!parsed.success) {
      // Mock contract violation — surface it (the controller validates input too,
      // so this is a defensive check).
      throw new Error(
        `create-customer mock invalid params: ${parsed.error.message}`,
      );
    }
    const p = parsed.data;
    appCustomerCounter += 1;
    const customerId = `APP-${String(appCustomerCounter).padStart(6, '0')}`;
    const fullAddress = `${p.address.street}, ${p.address.ward}, ${p.address.district}, ${p.address.city}`;
    const record: CustomerProfileResponse = {
      customerId,
      fullName: p.fullName,
      classification: p.classification,
      address: { ...p.address, fullAddress },
      contactInfo: p.contactInfo,
      status: p.status,
    };
    this.createdCustomers.set(customerId, record);
    if (p.contactInfo.phone) {
      this.phoneIndex.set(this.normalizePhone(p.contactInfo.phone), customerId);
    }
    this.logger.log(`Mock create-customer → ${customerId} (${p.fullName})`);
    return record;
  }

  private normalizePhone(phone: string): string {
    // Canonical VN form: digits only, drop the +84 country code and any leading 0
    // so '0901234567', '+84901234567', and '84901234567' all match.
    let digits = phone.replace(/\D/g, '');
    if (digits.startsWith('84')) digits = digits.slice(2);
    digits = digits.replace(/^0+/, '');
    return digits;
  }
}
