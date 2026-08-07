/**
 * E-contract dossier ownership (A2 Layer-2 sub-path) — IDOR proof.
 *
 * MockEcontractAdapter enforces dossier ownership: get-contract / sign-contract for another
 * customer's dossierId (or an unknown one) → 404 (same shape as not-found, no oracle).
 * Seed: DOS-2026-0042 owned by QN-0912345.
 */

import { MockEcontractAdapter } from '../../src/modules/service-request/clients/econtract.client';
import { NotFoundException } from '../../src/libs/core/common/exceptions';

const A = 'QN-0912345'; // owns DOS-2026-0042
const B = 'QN-0888891';

describe('E-contract dossier ownership — A2 Layer-2 IDOR fix', () => {
  let adapter: MockEcontractAdapter;
  beforeEach(() => {
    adapter = new MockEcontractAdapter();
  });

  it('get-contract for OWN dossier returns data', async () => {
    const r = await adapter.execute('get-contract', {
      customerId: A,
      dossierId: 'DOS-2026-0042',
    });
    expect(r).toMatchObject({ dossierId: 'DOS-2026-0042' });
  });

  it('IDOR: get-contract for ANOTHER customer’s dossier → 404', async () => {
    await expect(
      adapter.execute('get-contract', {
        customerId: B,
        dossierId: 'DOS-2026-0042',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('IDOR: sign-contract for ANOTHER customer’s dossier → 404 (no sign)', async () => {
    await expect(
      adapter.execute('sign-contract', {
        customerId: B,
        dossierId: 'DOS-2026-0042',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('denied (not-owned) is indistinguishable from not-found (no oracle)', async () => {
    await expect(
      adapter.execute('get-contract', {
        customerId: B,
        dossierId: 'DOS-2026-0042',
      }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      adapter.execute('get-contract', {
        customerId: A,
        dossierId: 'DOS-NOPE',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
