import { MockCustomerProfileAdapter } from './customer-profile.client';

/**
 * Verifies the STATEFUL behavior added to MockCustomerProfileAdapter:
 *  - `create-customer` builds + stores a record (id APP-NNNNNN) in-memory.
 *  - `get-profile` / `find-by-phone` resolve app-registered customers (not fixtures).
 *  - unknown ids still fall back to the JSON fixture.
 *
 * No DB needed — this is pure mock-adapter logic.
 */
describe('MockCustomerProfileAdapter (stateful create-customer)', () => {
  let adapter: MockCustomerProfileAdapter;

  beforeEach(() => {
    adapter = new MockCustomerProfileAdapter();
  });

  const createPayload = {
    fullName: 'Trần Thị B',
    classification: 'sinh_hoat' as const,
    address: { street: '45 Trần Phú', ward: 'Phường Lộc Sơn', district: 'Quận Ngũ Hành Sơn', city: 'Đà Nẵng' },
    contactInfo: { phone: '0901234567', email: 'tran.b@email.com', contactAddress: null },
    status: 'active' as const,
  };

  it('create-customer returns a stored record with an APP- id + derived fullAddress', async () => {
    const rec = (await adapter.execute('create-customer', createPayload)) as Record<string, unknown>;
    expect(rec.customerId).toMatch(/^APP-\d{6}$/);
    expect(rec.fullName).toBe('Trần Thị B');
    expect(rec.classification).toBe('sinh_hoat');
    expect(rec.status).toBe('active');
    expect((rec.address as Record<string, unknown>).fullAddress).toBe(
      '45 Trần Phú, Phường Lộc Sơn, Quận Ngũ Hành Sơn, Đà Nẵng',
    );
    expect((rec.contactInfo as Record<string, unknown>).phone).toBe('0901234567');
  });

  it('get-profile returns the created record (NOT the seed fixture)', async () => {
    const created = (await adapter.execute('create-customer', createPayload)) as {
      customerId: string;
      fullName: string;
    };
    const fetched = (await adapter.execute('get-profile', { customerId: created.customerId })) as {
      customerId: string;
      fullName: string;
    };
    expect(fetched.customerId).toBe(created.customerId);
    expect(fetched.fullName).toBe('Trần Thị B'); // fixture would be 'Nguyễn Anh Tuấn'
  });

  it('find-by-phone resolves the created customer by phone (normalized)', async () => {
    await adapter.execute('create-customer', createPayload);
    const byPhone = (await adapter.execute('find-by-phone', { phone: '+84901234567' })) as {
      fullName: string;
    };
    expect(byPhone.fullName).toBe('Trần Thị B');
  });

  it('unknown customerId falls back to the seed fixture', async () => {
    const seed = (await adapter.execute('get-profile', { customerId: 'USR-20240101-0001' })) as {
      customerId: string;
      fullName: string;
    };
    expect(seed.customerId).toBe('USR-20240101-0001');
    expect(seed.fullName).toBe('Nguyễn Anh Tuấn');
  });
});
