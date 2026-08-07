/**
 * Contract ownership (A2 Layer-2) — IDOR proof for the contract port.
 *
 * MockContractAdapter scopes by the BOUND customerId: get-contracts returns only owned
 * contracts; detail/versions/pdf for another customer's contractId → 404 (same shape as
 * not-found, no oracle). Seed: QN-0912345 owns CTR-2024-0001; QN-0888891 owns CTR-2023-0012.
 */

import { MockContractAdapter } from '../../src/modules/service-request/clients/contract.client';
import { NotFoundException } from '../../src/libs/core/common/exceptions';

const A = 'QN-0912345'; // owns CTR-2024-0001
const B = 'QN-0888891'; // owns CTR-2023-0012

describe('Contract ownership — A2 Layer-2 IDOR fix', () => {
  let adapter: MockContractAdapter;
  beforeEach(() => {
    adapter = new MockContractAdapter();
  });

  it('get-contracts scopes to the bound customer', async () => {
    const resA = (await adapter.execute('get-contracts', {
      customerId: A,
    })) as { contracts: { contractId: string }[]; totalCount: number };
    expect(resA.contracts.map((c) => c.contractId)).toEqual(['CTR-2024-0001']);
    expect(resA.totalCount).toBe(1);

    const resB = (await adapter.execute('get-contracts', {
      customerId: B,
    })) as { contracts: { contractId: string }[] };
    expect(resB.contracts.map((c) => c.contractId)).toEqual(['CTR-2023-0012']);
  });

  it('detail for an OWNED contract returns data', async () => {
    const r = await adapter.execute('get-contract-detail', {
      customerId: A,
      contractId: 'CTR-2024-0001',
    });
    expect(r).toMatchObject({ contractId: 'CTR-2024-0001' });
  });

  it('IDOR: detail for ANOTHER customer’s contract → 404', async () => {
    await expect(
      adapter.execute('get-contract-detail', {
        customerId: A,
        contractId: 'CTR-2023-0012',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('IDOR: versions + pdf for ANOTHER customer’s contract → 404', async () => {
    await expect(
      adapter.execute('get-contract-versions', {
        customerId: A,
        contractId: 'CTR-2023-0012',
      }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      adapter.execute('get-contract-pdf', {
        customerId: A,
        contractId: 'CTR-2023-0012',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('denied (not-owned) is indistinguishable from not-found (no oracle)', async () => {
    await expect(
      adapter.execute('get-contract-detail', {
        customerId: A,
        contractId: 'CTR-2023-0012',
      }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      adapter.execute('get-contract-detail', {
        customerId: A,
        contractId: 'CTR-NOPE',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('does NOT leak the ownership mark', async () => {
    const list = await adapter.execute('get-contracts', { customerId: A });
    expect(JSON.stringify(list)).not.toContain('ownerCustomerId');
    expect(JSON.stringify(list)).not.toContain('QN-0912345');
  });
});
