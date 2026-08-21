import { MockCustomerProfileAdapter } from './customer-profile.client';

/**
 * Fake DrizzleDB cho adapter — mỗi test seed rows riêng; `where` bị bỏ qua
 * (mỗi test chỉ có đúng row cần khớp trong store).
 */
function makeDb(initialRows: Record<string, unknown>[] = []) {
  const rows = initialRows;
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: async () => rows.slice(),
  };
  return {
    rows,
    insert: jest.fn(() => ({ values: jest.fn(async (v: Record<string, unknown>) => { rows.push(v); }) })),
    select: jest.fn(() => selectChain),
  };
}

describe('MockCustomerProfileAdapter (durable create-customer)', () => {
  const createPayload = {
    fullName: 'Trần Thị B',
    classification: 'sinh_hoat' as const,
    address: { street: '45 Trần Phú', ward: 'Phường Lộc Sơn', district: 'Quận Ngũ Hành Sơn', city: 'Đà Nẵng' },
    contactInfo: { phone: '0901234567', email: 'tran.b@email.com', contactAddress: null },
    status: 'active' as const,
  };

  it('create-customer returns a stored record with an APP- id + derived fullAddress', async () => {
    const db = makeDb();
    const adapter = new MockCustomerProfileAdapter(db as any);
    const rec = (await adapter.execute('create-customer', createPayload)) as Record<string, unknown>;
    expect(rec.customerId).toMatch(/^APP-\d{6}$/);
    expect(rec.fullName).toBe('Trần Thị B');
    expect(rec.classification).toBe('sinh_hoat');
    expect(rec.status).toBe('active');
    expect((rec.address as Record<string, unknown>).fullAddress).toBe(
      '45 Trần Phú, Phường Lộc Sơn, Quận Ngũ Hành Sơn, Đà Nẵng',
    );
    expect(db.rows).toHaveLength(1); // đã persist
  });

  it('đánh số APP- tiếp tục từ max trong store (không reset sau restart)', async () => {
    const db = makeDb([
      { customerId: 'APP-000002', phone: '901234567', fullName: 'Cũ', classification: 'sinh_hoat', address: {}, contactInfo: null, status: 'active' },
    ]);
    const adapter = new MockCustomerProfileAdapter(db as any);
    const rec = (await adapter.execute('create-customer', createPayload)) as { customerId: string };
    expect(rec.customerId).toBe('APP-000003');
  });

  it('get-profile trả về record đã tạo (KHÔNG phải fixture)', async () => {
    const adapter = new MockCustomerProfileAdapter(makeDb() as any);
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

  it('DURABILITY: adapter mới (giả lập BFF restart) + cùng DB vẫn trả khách đã tạo', async () => {
    const db = makeDb();
    const adapter1 = new MockCustomerProfileAdapter(db as any);
    const created = (await adapter1.execute('create-customer', createPayload)) as { customerId: string };
    // "Restart": instance mới, cùng hậu cứ DB.
    const adapter2 = new MockCustomerProfileAdapter(db as any);
    const fetched = (await adapter2.execute('get-profile', { customerId: created.customerId })) as {
      fullName: string;
    } | null;
    expect(fetched?.fullName).toBe('Trần Thị B');
  });

  it('find-by-phone resolves the created customer by phone (normalized)', async () => {
    const adapter = new MockCustomerProfileAdapter(makeDb() as any);
    await adapter.execute('create-customer', createPayload);
    const byPhone = (await adapter.execute('find-by-phone', { phone: '+84901234567' })) as {
      fullName: string;
    };
    expect(byPhone.fullName).toBe('Trần Thị B');
  });

  it('customerId KHÔNG nằm trong store và KHÔNG phải seed → null (không fallback fixture)', async () => {
    const adapter = new MockCustomerProfileAdapter(makeDb() as any);
    const res = await adapter.execute('get-profile', { customerId: 'APP-999999' });
    expect(res).toBeNull(); // trước đây: fixture 'Nguyễn Anh Tuấn' = lộ hồ sơ người khác
  });

  it('customerId seed (QN-0912345) vẫn serve fixture — khách existing testable', async () => {
    const adapter = new MockCustomerProfileAdapter(makeDb() as any);
    const seed = (await adapter.execute('get-profile', { customerId: 'QN-0912345' })) as {
      customerId: string;
      fullName: string;
    };
    expect(seed.customerId).toBe('QN-0912345');
    expect(seed.fullName).toBe('Nguyễn Anh Tuấn');
  });
});
