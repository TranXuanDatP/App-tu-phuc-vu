/**
 * Phản ánh ownership (A2 Layer-2) — IDOR proof for the incident-report (Phản ánh) port.
 *
 * MockIncidentAdapter scopes Phản ánh by the BOUND customerId (reporter): get-my-reports
 * returns only the customer's reports; get-report-detail for another customer's reportId →
 * 404 (same shape as not-found, no oracle); create-report assigns reporter = customerId.
 *
 * Seed: QN-0912345 owns SC-2026-00042; QN-0888891 owns SC-2026-00038.
 */

import { MockIncidentAdapter } from '../../src/modules/report/clients/incident.client';
import { NotFoundException } from '../../src/libs/core/common/exceptions';

const A = 'QN-0912345'; // owns SC-2026-00042
const B = 'QN-0888891'; // owns SC-2026-00038

const BODY = {
  type: 'low_pressure',
  description: 'Áp lực nước yếu',
  location: { lat: 16, lng: 108, address: '12 Lê Lợi', area: 'DN-HC-1' },
};

describe('Phản ánh ownership — A2 Layer-2 IDOR fix', () => {
  let adapter: MockIncidentAdapter;
  beforeEach(() => {
    adapter = new MockIncidentAdapter();
  });

  it('get-my-reports scopes to the bound customer (reporter)', async () => {
    const resA = (await adapter.execute('get-my-reports', {
      customerId: A,
    })) as { reports: { reportId: string }[]; totalCount: number };
    expect(resA.reports.map((r) => r.reportId)).toContain('SC-2026-00042');
    expect(resA.reports.map((r) => r.reportId)).not.toContain('SC-2026-00038');

    const resB = (await adapter.execute('get-my-reports', {
      customerId: B,
    })) as { reports: { reportId: string }[] };
    expect(resB.reports.map((r) => r.reportId)).toEqual(['SC-2026-00038']);
  });

  it('get-report-detail for an OWNED report returns data', async () => {
    const r = await adapter.execute('get-report-detail', {
      customerId: A,
      reportId: 'SC-2026-00042',
    });
    expect(r).toMatchObject({ reportId: 'SC-2026-00042', customerId: A });
  });

  it('IDOR: get-report-detail for ANOTHER customer’s report → 404', async () => {
    await expect(
      adapter.execute('get-report-detail', {
        customerId: A,
        reportId: 'SC-2026-00038',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('denied (not-owned) is indistinguishable from not-found (no oracle)', async () => {
    await expect(
      adapter.execute('get-report-detail', {
        customerId: A,
        reportId: 'SC-2026-00038',
      }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      adapter.execute('get-report-detail', {
        customerId: A,
        reportId: 'SC-NOPE',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('create-report assigns reporter = bound customerId, visible in get-my-reports', async () => {
    const created = (await adapter.execute('create-report', {
      customerId: A,
      ...BODY,
    })) as { reportId: string };
    expect(created.reportId).toMatch(/^SC-2026-\d{5}$/);

    // The new report belongs to A (reporter = A) — A sees it, B does not.
    const resA = (await adapter.execute('get-my-reports', {
      customerId: A,
    })) as { reports: { reportId: string; customerId: string }[] };
    const mine = resA.reports.find((r) => r.reportId === created.reportId);
    expect(mine).toBeDefined();
    expect(mine!.customerId).toBe(A);

    const resB = (await adapter.execute('get-my-reports', {
      customerId: B,
    })) as { reports: { reportId: string }[] };
    expect(resB.reports.map((r) => r.reportId)).not.toContain(created.reportId);

    // IDOR: B cannot read A's just-created report.
    await expect(
      adapter.execute('get-report-detail', {
        customerId: B,
        reportId: created.reportId,
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
