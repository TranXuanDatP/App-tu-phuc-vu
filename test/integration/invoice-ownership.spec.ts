/**
 * Invoice ownership (A2 Layer-2) — the IDOR proof.
 *
 * Exercises MockInvoiceAdapter directly: the BOUND customerId (from @CustomerId,
 * never client-supplied) scopes every read. A bound customer CANNOT read another
 * customer's invoice (404, same shape as not-found) nor see it in their list.
 *
 * This is the test that could NOT pass before A2 — the mock previously returned the
 * fixture regardless of customerId. Combined with the controller passing the bound
 * customerId (Layer-1) and the service already forwarding it, the IDOR is closed at
 * the controller→data path.
 *
 * Seed: QN-0912345 owns INV-2026-001/002/003; QN-0888891 owns INV-2026-004.
 */

import { MockInvoiceAdapter } from '../../src/modules/billing/clients/invoice.client';
import { NotFoundException } from '../../src/libs/core/common/exceptions';

const A = 'QN-0912345'; // owns 001/002/003
const B = 'QN-0888891'; // owns 004

describe('Invoice ownership — A2 Layer-2 IDOR fix', () => {
  let adapter: MockInvoiceAdapter;

  beforeEach(() => {
    adapter = new MockInvoiceAdapter();
  });

  it('get-list scopes to the bound customer — A sees only own invoices, never B’s', async () => {
    const resA = (await adapter.execute('get-list', { customerId: A })) as {
      invoices: { invoiceId: string }[];
    };
    expect(resA.invoices).toHaveLength(3);
    expect(resA.invoices.map((i) => i.invoiceId)).toEqual(
      expect.arrayContaining(['INV-2026-001', 'INV-2026-002', 'INV-2026-003']),
    );
    expect(resA.invoices.map((i) => i.invoiceId)).not.toContain('INV-2026-004');
  });

  it('get-list for customer B returns only B’s invoice', async () => {
    const resB = (await adapter.execute('get-list', { customerId: B })) as {
      invoices: { invoiceId: string }[];
    };
    expect(resB.invoices).toHaveLength(1);
    expect(resB.invoices[0].invoiceId).toBe('INV-2026-004');
  });

  it('get-by-id returns detail for an OWNED invoice', async () => {
    const detail = (await adapter.execute('get-by-id', {
      customerId: A,
      invoiceId: 'INV-2026-001',
    })) as { invoiceId: string };
    expect(detail.invoiceId).toBe('INV-2026-001');
  });

  it('IDOR: get-by-id for ANOTHER customer’s invoice → 404 (denied)', async () => {
    // A is bound; requests B's invoice INV-2026-004 → must be denied.
    await expect(
      adapter.execute('get-by-id', { customerId: A, invoiceId: 'INV-2026-004' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('IDOR: denied (not-owned) is indistinguishable from not-found (no oracle)', async () => {
    // Both a not-owned real invoice and a nonexistent id → NotFoundException.
    await expect(
      adapter.execute('get-by-id', { customerId: A, invoiceId: 'INV-2026-004' }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      adapter.execute('get-by-id', { customerId: A, invoiceId: 'INV-NOPE' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('does NOT leak the ownership mark in the API response', async () => {
    const detail = await adapter.execute('get-by-id', {
      customerId: A,
      invoiceId: 'INV-2026-001',
    });
    expect(JSON.stringify(detail)).not.toContain('ownerCustomerId');
    expect(JSON.stringify(detail)).not.toContain('QN-0912345');
  });
});
