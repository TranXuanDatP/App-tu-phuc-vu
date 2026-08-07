/**
 * Smart-meter status ownership (A2 Layer-2 sub-path) — IDOR proof.
 *
 * MockSmartMeterAdapter enforces meter ownership for get-meter-status (ownership source =
 * the meter list mocks/meter/get-meter-by-customer.json). Status for another customer's
 * meterId, or an unknown meterId → 404 (same shape as not-found, no oracle).
 * Seed: QN-0912345 owns MT-001/MT-002; QN-0888891 owns MT-003.
 */

import { MockSmartMeterAdapter } from '../../src/modules/usage/clients/smart-meter.client';
import { NotFoundException } from '../../src/libs/core/common/exceptions';

const A = 'QN-0912345'; // owns MT-001
const B = 'QN-0888891'; // owns MT-003

describe('Smart-meter status ownership — A2 Layer-2 IDOR fix', () => {
  let adapter: MockSmartMeterAdapter;
  beforeEach(() => {
    adapter = new MockSmartMeterAdapter();
  });

  it('get-meter-status for OWN meter returns data', async () => {
    const r = await adapter.execute('get-meter-status', {
      customerId: A,
      meterId: 'MT-001',
    });
    expect(r).toBeDefined();
  });

  it('IDOR: get-meter-status for ANOTHER customer’s meter → 404', async () => {
    await expect(
      adapter.execute('get-meter-status', {
        customerId: A,
        meterId: 'MT-003',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('denied (not-owned) is indistinguishable from not-found (no oracle)', async () => {
    await expect(
      adapter.execute('get-meter-status', {
        customerId: A,
        meterId: 'MT-003',
      }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      adapter.execute('get-meter-status', {
        customerId: A,
        meterId: 'MT-NOPE',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
