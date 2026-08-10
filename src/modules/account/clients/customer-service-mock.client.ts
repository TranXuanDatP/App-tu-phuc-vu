/**
 * Mock Customer-Service Client — implements the resolve/verify/profile contract
 * (SPEC-A4-A1 §A4) with the Rev-2 security behaviours ENCODED, so the binding flow
 * can be built and tested before the real customer-service exists.
 *
 * Security behaviours this mock must NOT regress (each is asserted in
 * test/integration/customer-service-mock-contract.spec.ts):
 *  - resolve NEVER returns customerId / fullName / phone / mã KH — only customerRef
 *    plus an ADDRESS-based maskedHint (Fix 3: hint independent of any factor that
 *    could itself be the secret).
 *  - 0-match returns the identical {status:'none'} every time — no enumeration signal.
 *  - verify returns {verified:false} for wrong-value AND unknown-customerRef with the
 *    SAME shape (no oracle), and never echoes the real secret.
 *  - profile returns full data — but the BFF only reaches it AFTER a verified binding.
 *
 * Seed: REF-001..004. REF-003 + REF-004 share a phone → exercises N-match
 * disambiguation by ADDRESS (not by mã KH). Secrets are last_invoice_amount, held
 * server-side only.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConflictException } from '@core/common';
import type { CustomerProfileResponse } from '../dto/customer-profile.dto';
import type {
  CustomerServiceClient,
  CreateCustomerRequest,
  CreateCustomerResult,
  ResolveResult,
  ChallengeDescriptor,
  VerifyRequest,
  VerifyResult,
} from './customer-service.client';

interface SeedCustomer {
  customerRef: string;
  fullName: string;
  /** Canonical digits (84 + leading-0 stripped) — what normalizePhone() yields. */
  phone: string;
  customerId: string;
  classification: CustomerProfileResponse['classification'];
  lastInvoiceAmount: string;
  /** Hint basis — street + district only (Fix 3). */
  addressPrefix: string;
  fullAddress: CustomerProfileResponse['address'];
}

// Canonical-phone seed data. +84987654321 → '987654321' (REF-001, the main test customer
// with meter+invoice data); N-match test pair on '9777666555' (REF-003 + REF-004).
const SEED_CUSTOMERS: SeedCustomer[] = [
  {
    customerRef: 'REF-001',
    fullName: 'Nguyễn Văn Nam',
    phone: '987654321',
    customerId: 'QN-0912345',
    classification: 'sinh_hoat',
    lastInvoiceAmount: '247500',
    addressPrefix: '12 Lê Lợi, Hải Châu',
    fullAddress: {
      street: '12 Lê Lợi',
      ward: 'Hải Châu 1',
      district: 'Hải Châu',
      city: 'Đà Nẵng',
      fullAddress: '12 Lê Lợi, Hải Châu 1, Hải Châu, Đà Nẵng',
    },
  },
  {
    customerRef: 'REF-002',
    fullName: 'Trần Thị Hoa',
    phone: '912345678',
    customerId: 'QN-0888891',
    classification: 'san_xuat',
    lastInvoiceAmount: '189000',
    addressPrefix: '45 Trần Phú, Sơn Trà',
    fullAddress: {
      street: '45 Trần Phú',
      ward: 'An Hải Bắc',
      district: 'Sơn Trà',
      city: 'Đà Nẵng',
      fullAddress: '45 Trần Phú, An Hải Bắc, Sơn Trà, Đà Nẵng',
    },
  },
  {
    customerRef: 'REF-003',
    fullName: 'Lê Minh',
    phone: '9777666555',
    customerId: 'QN-0777123',
    classification: 'sinh_hoat',
    lastInvoiceAmount: '312000',
    addressPrefix: 'Lê Lợi, Hải Châu',
    fullAddress: {
      street: 'Lê Lợi',
      ward: 'Hải Châu 1',
      district: 'Hải Châu',
      city: 'Đà Nẵng',
      fullAddress: 'Lê Lợi, Hải Châu 1, Hải Châu, Đà Nẵng',
    },
  },
  {
    customerRef: 'REF-004',
    fullName: 'Lê Minh Khôi',
    phone: '9777666555',
    customerId: 'QN-0666001',
    classification: 'hanh_chinh',
    lastInvoiceAmount: '156000',
    addressPrefix: 'Trần Phú, Sơn Trà',
    fullAddress: {
      street: 'Trần Phú',
      ward: 'An Hải Bắc',
      district: 'Sơn Trà',
      city: 'Đà Nẵng',
      fullAddress: 'Trần Phú, An Hải Bắc, Sơn Trà, Đà Nẵng',
    },
  },
  // N>3 cap cluster (Fix-3 cond. b) — 4 customers share phone '666555444' (a shared/
  // recycled number) → resolve returns {status:'many', capped:true}, NO candidates.
  {
    customerRef: 'REF-005', fullName: 'Phạm Văn Năm', phone: '666555444',
    customerId: 'QN-0555001', classification: 'sinh_hoat', lastInvoiceAmount: '100000',
    addressPrefix: 'Hùng Vương, Liên Chiểu',
    fullAddress: { street: 'Hùng Vương', ward: 'Hòa Khê', district: 'Liên Chiểu', city: 'Đà Nẵng', fullAddress: 'Hùng Vương, Hòa Khê, Liên Chiểu, Đà Nẵng' },
  },
  {
    customerRef: 'REF-006', fullName: 'Phạm Thị Sáu', phone: '666555444',
    customerId: 'QN-0666002', classification: 'sinh_hoat', lastInvoiceAmount: '110000',
    addressPrefix: 'Điện Biên Phủ, Thanh Khê',
    fullAddress: { street: 'Điện Biên Phủ', ward: 'Thanh Khê Đông', district: 'Thanh Khê', city: 'Đà Nẵng', fullAddress: 'Điện Biên Phủ, Thanh Khê Đông, Thanh Khê, Đà Nẵng' },
  },
  {
    customerRef: 'REF-007', fullName: 'Phạm Văn Bảy', phone: '666555444',
    customerId: 'QN-0777003', classification: 'san_xuat', lastInvoiceAmount: '120000',
    addressPrefix: 'Nguyễn Tri Phương, Liên Chiểu',
    fullAddress: { street: 'Nguyễn Tri Phương', ward: 'Hòa Khê Bắc', district: 'Liên Chiểu', city: 'Đà Nẵng', fullAddress: 'Nguyễn Tri Phương, Hòa Khê Bắc, Liên Chiểu, Đà Nẵng' },
  },
  {
    customerRef: 'REF-008', fullName: 'Phạm Thị Tám', phone: '666555444',
    customerId: 'QN-0888004', classification: 'hanh_chinh', lastInvoiceAmount: '130000',
    addressPrefix: 'Hải Phòng, Thanh Khê',
    fullAddress: { street: 'Hải Phòng', ward: 'Xuân Hà', district: 'Thanh Khê', city: 'Đà Nẵng', fullAddress: 'Hải Phòng, Xuân Hà, Thanh Khê, Đà Nẵng' },
  },
];

// Module-level counter for customers created via the new-customer branch (register→bind).
let createdCustomerCounter = 0;

@Injectable()
export class MockCustomerServiceClient implements CustomerServiceClient {
  private readonly logger = new Logger(MockCustomerServiceClient.name);
  /** normalized phone → seed-shaped record, for customers created via create(). */
  private readonly createdCustomers = new Map<string, SeedCustomer>();

  async resolve(phone: string): Promise<ResolveResult> {
    const norm = this.normalizePhone(phone);
    // Created customers first (so resolve sees them after a create in the same process).
    const created = Array.from(this.createdCustomers.values()).filter(
      (c) => c.phone === norm,
    );
    const matches = [...created, ...SEED_CUSTOMERS.filter((c) => c.phone === norm)];

    if (matches.length === 0) {
      // Identical response every time — no enumeration signal.
      return { status: 'none' };
    }
    if (matches.length === 1) {
      const c = matches[0];
      return {
        status: 'one',
        customerRef: c.customerRef,
        maskedHint: this.hint(c),
        challenge: this.challengeFor(c),
      };
    }
    // N-match cap (Fix-3 cond. b): N>3 is not a household — shared/recycled phone or
    // data error. Return NO candidates (no enumeration surface); mobile routes to hotline.
    if (matches.length > 3) {
      return { status: 'many', capped: true };
    }
    // 2-3 matches — disambiguate by ADDRESS (Fix 3), never by mã KH / contract # / amount.
    return {
      status: 'many',
      candidates: matches.map((c) => ({
        customerRef: c.customerRef,
        maskedHint: this.hint(c),
        challenge: this.challengeFor(c),
      })),
    };
  }

  /**
   * create() — new-customer branch. ATOMIC phone-uniqueness (reject point 2, the race
   * gate): if a customer for this phone already exists (seed OR previously created in
   * this process), throw ConflictException → BFF reroutes to challenge, NEVER auto-binds.
   * Created customers are visible to resolve() thereafter.
   */
  async create(
    phone: string,
    profile: CreateCustomerRequest,
  ): Promise<CreateCustomerResult> {
    const norm = this.normalizePhone(phone);
    const exists =
      this.createdCustomers.has(norm) ||
      SEED_CUSTOMERS.some((c) => c.phone === norm);
    if (exists) {
      // Race tail (or seed): customer for this phone is now present. Fail-closed.
      throw new ConflictException(
        'A customer for this phone already exists',
        'CUSTOMER_PHONE_EXISTS',
        { phone: norm },
      );
    }

    createdCustomerCounter += 1;
    const n = String(createdCustomerCounter).padStart(6, '0');
    const customerRef = `REF-NEW-${n}`;
    const customerId = `APP-${n}`;
    const fullAddress = `${profile.address.street}, ${profile.address.ward}, ${profile.address.district}, ${profile.address.city}`;
    const record: SeedCustomer = {
      customerRef,
      fullName: profile.fullName,
      phone: norm,
      customerId,
      classification: profile.classification,
      lastInvoiceAmount: '', // no bill-secret for a brand-new customer (creation = proof)
      addressPrefix: `${profile.address.street}, ${profile.address.district}`,
      fullAddress: {
        street: profile.address.street,
        ward: profile.address.ward,
        district: profile.address.district,
        city: profile.address.city,
        fullAddress,
      },
    };
    this.createdCustomers.set(norm, record);
    this.logger.log(`Mock create → ${customerId} (${customerRef}, ${profile.fullName})`);
    return { customerId, customerRef };
  }

  async verify(req: VerifyRequest): Promise<VerifyResult> {
    const c = SEED_CUSTOMERS.find((x) => x.customerRef === req.customerRef);
    // Identical shape for "unknown ref" and "wrong value" — no oracle. Never echo
    // the real secret value.
    if (!c) return { verified: false };
    if (req.secretType !== 'last_invoice_amount') return { verified: false };
    return { verified: c.lastInvoiceAmount === req.secretValue };
  }

  async profile(customerRef: string): Promise<CustomerProfileResponse> {
    const c = SEED_CUSTOMERS.find((x) => x.customerRef === customerRef);
    if (!c) {
      throw new Error(`Mock profile: unknown customerRef ${customerRef}`);
    }
    // The BFF only reaches here after a verified binding.
    return {
      customerId: c.customerId,
      fullName: c.fullName,
      classification: c.classification,
      address: c.fullAddress,
      contactInfo: {
        phone: `+84${c.phone}`,
        email: null,
        contactAddress: c.fullAddress.fullAddress,
      },
      status: 'active',
    };
  }

  async resolveChannel(channel: string, channelId: string): Promise<ResolveResult> {
    // Omnichannel future — APP reuses phone resolve; other channels → 'none' (stub).
    if (channel === 'APP') return this.resolve(channelId);
    return { status: 'none' };
  }

  // "Nguyễn Văn Nam" → "Nguyễn V***"; "Lê Minh" → "Lê M***"; "Hoa" → "Hoa***".
  private maskedName(fullName: string): string {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return `${parts[0]}***`;
    return `${parts[0]} ${parts[1][0]}***`;
  }

  private hint(c: SeedCustomer): string {
    return `${this.maskedName(c.fullName)} • ${c.addressPrefix}`;
  }

  /**
   * BE chooses the verify factor server-side and describes it here. Mobile renders the
   * descriptor (label + inputMode) and echoes `type` as secretType — it never knows the
   * enum, so B5 changing the factor is a one-line BE change. Fix-3 cond. (c) survives:
   * maskedHint stays address-based regardless of which factor verifies.
   */
  private challengeFor(_c: SeedCustomer): ChallengeDescriptor {
    return {
      type: 'last_invoice_amount',
      label: 'Số tiền hoá đơn gần nhất',
      inputMode: 'numeric',
    };
  }

  private normalizePhone(phone: string): string {
    // Canonical VN form: digits only, drop +84 country code and leading 0, so
    // '0901234567', '+84901234567', '84901234567' all match.
    let digits = phone.replace(/\D/g, '');
    if (digits.startsWith('84')) digits = digits.slice(2);
    digits = digits.replace(/^0+/, '');
    return digits;
  }
}
