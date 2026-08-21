/**
 * Mock adapter for the customer-profile port (downstream Account/Customer service).
 *
 * Mock-first + STATEFUL + DURABLE: customers created via `create-customer` live in
 * the `mock_customer_store` table (migration 0010) — they survive BFF restarts.
 * (The old in-memory Map reset on every restart, so get-profile fell back to the
 * shared JSON fixture and a freshly-registered user saw SOMEONE ELSE's profile —
 * bug caught 2026-08-21.)
 *
 * Fixture fallback is now STRICT: only the known seed customerId(s) serve fixture
 * data; any other unknown id returns null. Unknown ≠ "show the fixture customer".
 *
 * When the real Customer 360 service is ready, replace this adapter with an
 * InternalAdapterBase subclass (2nd arg of portRegistry.register) — flip
 * config/api-endpoints.yaml `adapter: live`.
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { MockAdapterBase } from '@shared/port/mock-adapter.base';
import { type DrizzleDB } from '@shared';
import { DATABASE_WRITE_TOKEN } from '@core/constants/tokens';
import {
  CustomerProfileSchema,
  CreateCustomerRequestSchema,
  TimelineResponseSchema,
  RelatedAccountsResponseSchema,
  UpdateProfileResponseSchema,
} from '../dto/customer-profile.dto';
import type { CustomerProfileResponse } from '../dto/customer-profile.dto';
import { mockCustomerStoreTable } from '../infrastructure/persistence/drizzle/schema/mock-customer-store.schema';

// Normalized phones of pre-seeded "existing customers" (the find-by-phone
// fixture, customerId QN-0912345). Login with any of these → recognized as an
// existing customer; any other phone → no match → "Bạn chưa đăng ký tài khoản".
const EXISTING_CUSTOMER_PHONES = new Set(['987654321', '901234567']);

// CustomerId của khách seed — DUY NHẤT các id này được phép fallback về fixture.
// QN-0912345 = id mà binding mock (REF-001) cấp; USR-20240101-0001 = id nội bộ
// của chính fixture. Id khác không nằm trong mock_customer_store → null
// (trước đây mọi id lạ đều nhận fixture = lộ hồ sơ khách khác cho user lạ).
const FIXTURE_CUSTOMER_IDS = new Set(['QN-0912345', 'USR-20240101-0001']);

type StoreRow = typeof mockCustomerStoreTable.$inferSelect;

@Injectable()
export class MockCustomerProfileAdapter extends MockAdapterBase {
  constructor(
    @Inject(DATABASE_WRITE_TOKEN) private readonly db: DrizzleDB,
  ) {
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

    if (method === 'get-profile') {
      const byId = params.customerId as string | undefined;
      if (!byId) return null;
      const stored = await this.findByCustomerId(byId);
      if (stored) return stored;
      // Chỉ id seed được fixture; id lạ → null (không lộ hồ sơ người khác).
      if (FIXTURE_CUSTOMER_IDS.has(byId)) {
        // Fixture mang id nội bộ riêng (USR-…) khác id binding mock cấp (QN-…) —
        // chuẩn hoá về id được yêu cầu để caller nhận profile đúng khóa của mình.
        const fixture = (await super.execute(method, params)) as CustomerProfileResponse;
        return { ...fixture, customerId: byId };
      }
      return null;
    }

    if (method === 'find-by-phone') {
      const phone = params.phone as string | undefined;
      if (!phone) return null;
      const stored = await this.findByPhone(phone);
      if (stored) return stored;
      if (EXISTING_CUSTOMER_PHONES.has(this.normalizePhone(phone))) {
        return super.execute(method, params);
      }
      return null;
    }

    return super.execute(method, params);
  }

  private rowToRecord(row: StoreRow): CustomerProfileResponse {
    return {
      customerId: row.customerId,
      fullName: row.fullName,
      classification: row.classification as CustomerProfileResponse['classification'],
      address: row.address as CustomerProfileResponse['address'],
      contactInfo: (row.contactInfo ?? undefined) as CustomerProfileResponse['contactInfo'],
      status: row.status as CustomerProfileResponse['status'],
    };
  }

  private async findByCustomerId(customerId: string): Promise<CustomerProfileResponse | null> {
    const rows = await this.db
      .select()
      .from(mockCustomerStoreTable)
      .where(eq(mockCustomerStoreTable.customerId, customerId))
      .limit(1);
    return rows[0] ? this.rowToRecord(rows[0]) : null;
  }

  private async findByPhone(phone: string): Promise<CustomerProfileResponse | null> {
    const rows = await this.db
      .select()
      .from(mockCustomerStoreTable)
      .where(eq(mockCustomerStoreTable.phone, this.normalizePhone(phone)))
      .limit(1);
    return rows[0] ? this.rowToRecord(rows[0]) : null;
  }

  private async createCustomer(
    params: Record<string, unknown>,
  ): Promise<CustomerProfileResponse> {
    const parsed = CreateCustomerRequestSchema.safeParse(params);
    if (!parsed.success) {
      // Mock contract violation — surface it (the controller validates input too,
      // so this is a defensive check).
      throw new Error(
        `create-customer mock invalid params: ${parsed.error.message}`,
      );
    }
    const p = parsed.data;
    const customerId = await this.nextCustomerId();
    const fullAddress = `${p.address.street}, ${p.address.ward}, ${p.address.district}, ${p.address.city}`;
    const record: CustomerProfileResponse = {
      customerId,
      fullName: p.fullName,
      classification: p.classification,
      address: { ...p.address, fullAddress },
      contactInfo: p.contactInfo,
      status: p.status,
    };
    await this.db.insert(mockCustomerStoreTable).values({
      customerId,
      phone: p.contactInfo.phone ? this.normalizePhone(p.contactInfo.phone) : null,
      fullName: p.fullName,
      classification: p.classification,
      address: record.address as unknown as Record<string, unknown>,
      contactInfo: (p.contactInfo ?? null) as Record<string, unknown> | null,
      status: p.status,
    });
    this.logger.log(`Mock create-customer → ${customerId} (${p.fullName})`);
    return record;
  }

  /** APP-NNNNNN — tiếp tục từ max trong store (không reset theo restart). */
  private async nextCustomerId(): Promise<string> {
    const rows = await this.db
      .select({ customerId: mockCustomerStoreTable.customerId })
      .from(mockCustomerStoreTable)
      .orderBy(desc(mockCustomerStoreTable.customerId))
      .limit(1);
    const last = rows[0]?.customerId; // 'APP-000003'
    const lastNum = last && /^APP-\d{6}$/.test(last) ? parseInt(last.slice(4), 10) : 0;
    return `APP-${String(lastNum + 1).padStart(6, '0')}`;
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
