/**
 * Meter ownership (A2 Layer-2) — IDOR proof for the meter port.
 *
 * MockMeterAdapter scopes by the BOUND customerId: get-meter-by-customer returns only owned
 * meters; calibration/history for another customer's meterId → 404 (same shape as not-found).
 *
 * Seed: QN-0912345 owns MT-001/MT-002; QN-0888891 owns MT-003.
 */

import { MockMeterAdapter } from '../../src/modules/usage/clients/meter.client';
import { NotFoundException } from '../../src/libs/core/common/exceptions';

const A = 'QN-0912345'; // owns MT-001, MT-002
const B = 'QN-0888891'; // owns MT-003

describe('Meter ownership — A2 Layer-2 IDOR fix', () => {
  let adapter: MockMeterAdapter;
  beforeEach(() => {
    adapter = new MockMeterAdapter();
  });

  it('get-meter-by-customer scopes to the bound customer — A sees MT-001/002, never MT-003', async () => {
    const resA = (await adapter.execute('get-meter-by-customer', {
      customerId: A,
    })) as { meters: { meterId: string }[]; totalCount: number };
    expect(resA.meters.map((m) => m.meterId)).toEqual(
      expect.arrayContaining(['MT-001', 'MT-002']),
    );
    expect(resA.meters.map((m) => m.meterId)).not.toContain('MT-003');
    expect(resA.totalCount).toBe(2);
  });

  it('get-meter-by-customer for B returns only MT-003', async () => {
    const resB = (await adapter.execute('get-meter-by-customer', {
      customerId: B,
    })) as { meters: { meterId: string }[]; totalCount: number };
    expect(resB.meters).toHaveLength(1);
    expect(resB.meters[0].meterId).toBe('MT-003');
  });

  it('calibration-status for an OWNED meter returns detail', async () => {
    const r = await adapter.execute('get-calibration-status', {
      customerId: A,
      meterId: 'MT-001',
    });
    expect(r).toMatchObject({ meterId: 'MT-001' });
  });

  it('IDOR: calibration-status for ANOTHER customer’s meter → 404', async () => {
    await expect(
      adapter.execute('get-calibration-status', {
        customerId: A,
        meterId: 'MT-003',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('IDOR: meter-history for ANOTHER customer’s meter → 404', async () => {
    await expect(
      adapter.execute('get-meter-history', { customerId: A, meterId: 'MT-003' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('denied (not-owned) is indistinguishable from not-found (no oracle)', async () => {
    await expect(
      adapter.execute('get-calibration-status', {
        customerId: A,
        meterId: 'MT-003',
      }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      adapter.execute('get-calibration-status', {
        customerId: A,
        meterId: 'MT-NOPE',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('does NOT leak the ownership mark in the response', async () => {
    const list = await adapter.execute('get-meter-by-customer', {
      customerId: A,
    });
    expect(JSON.stringify(list)).not.toContain('ownerCustomerId');
    expect(JSON.stringify(list)).not.toContain('QN-0912345');
  });
});
