/**
 * Mock customer-service contract tests (A4) — lock the secure resolve/verify/profile
 * shape the binding flow relies on, with the Rev-2 security behaviours asserted:
 *  - resolve leaks NO PII (customerId / fullName / phone / mã KH); hint is address-based.
 *  - 0-match is identical on repeat (no enumeration).
 *  - verify is oracle-free (unknown ref == wrong value, same shape) and never echoes secret.
 *
 * Pattern: direct client instantiation (matches test/integration/auth-contract.spec.ts).
 */

import { MockCustomerServiceClient } from '../../src/modules/account/clients/customer-service-mock.client';

describe('Mock customer-service contract (A4)', () => {
  let client: MockCustomerServiceClient;

  beforeEach(() => {
    client = new MockCustomerServiceClient();
  });

  // ── resolve/phone ──────────────────────────────────────────────────────────
  describe('resolve', () => {
    it('0-match → {status:"none"} and is identical on repeat (no enumeration)', async () => {
      const a = await client.resolve('+84900000000');
      const b = await client.resolve('+84900000000');
      expect(a).toEqual({ status: 'none' });
      expect(a).toEqual(b); // deep-equal — no per-call variance to enumerate on
    });

    it('1-match → {status:"one", customerRef, maskedHint} with address-based hint, no PII', async () => {
      const r = await client.resolve('+84987654321');
      expect(r.status).toBe('one');
      expect(r.customerRef).toBe('REF-001');
      expect(r.maskedHint).toMatch(/•/); // address-based separator
      // Must NOT leak real customerId / fullName / phone / mã KH
      const json = JSON.stringify(r);
      expect(json).not.toContain('QN-0912345'); // real customerId
      expect(json).not.toContain('Nguyễn Văn Nam'); // full name
      expect(json).not.toContain('901234567'); // phone digits
    });

    it('N-match → {status:"many", candidates[2]} differing by address, no customerId', async () => {
      const r = await client.resolve('+849777666555');
      expect(r.status).toBe('many');
      expect(r.candidates).toHaveLength(2);
      const hints = r.candidates!.map((c) => c.maskedHint);
      // Disambiguation is by ADDRESS, not by mã KH / contract # / amount.
      expect(hints.some((h) => h.includes('Lê Lợi'))).toBe(true);
      expect(hints.some((h) => h.includes('Trần Phú'))).toBe(true);
      const json = JSON.stringify(r);
      expect(json).not.toContain('QN-0777123');
      expect(json).not.toContain('QN-0666001');
    });

    it('accepts varied phone formats (0…/84/+) and still resolves', async () => {
      expect((await client.resolve('0987654321')).status).toBe('one');
      expect((await client.resolve('84987654321')).status).toBe('one');
    });
  });

  // ── verify ─────────────────────────────────────────────────────────────────
  describe('verify', () => {
    it('correct secret → {verified:true}', async () => {
      const r = await client.verify({
        customerRef: 'REF-001',
        secretType: 'last_invoice_amount',
        secretValue: '247500',
      });
      expect(r).toEqual({ verified: true });
    });

    it('wrong value → {verified:false}', async () => {
      const r = await client.verify({
        customerRef: 'REF-001',
        secretType: 'last_invoice_amount',
        secretValue: '000000',
      });
      expect(r).toEqual({ verified: false });
    });

    it('unknown customerRef → {verified:false} identical to wrong value (no oracle)', async () => {
      const unknown = await client.verify({
        customerRef: 'REF-999',
        secretType: 'last_invoice_amount',
        secretValue: '247500',
      });
      const wrong = await client.verify({
        customerRef: 'REF-001',
        secretType: 'last_invoice_amount',
        secretValue: '000000',
      });
      expect(unknown).toEqual(wrong); // same shape — attacker can't tell ref exists
    });

    it('never echoes the real secret value', async () => {
      const r = await client.verify({
        customerRef: 'REF-001',
        secretType: 'last_invoice_amount',
        secretValue: '247500',
      });
      expect(JSON.stringify(r)).not.toContain('247500');
    });

    it('unsupported secretType → {verified:false} (factor pluggable)', async () => {
      const r = await client.verify({
        customerRef: 'REF-001',
        secretType: 'ma_kh' as never,
        secretValue: 'QN-0912345',
      });
      expect(r).toEqual({ verified: false });
    });
  });

  // ── profile (post-binding only) ────────────────────────────────────────────
  describe('profile', () => {
    it('returns full profile for a known ref', async () => {
      const p = await client.profile('REF-001');
      expect(p.customerId).toBe('QN-0912345');
      expect(p.fullName).toBe('Nguyễn Văn Nam');
      expect(p.classification).toBe('sinh_hoat');
    });

    it('throws on unknown customerRef', async () => {
      await expect(client.profile('REF-999')).rejects.toThrow();
    });
  });

  // ── resolve/channel (omnichannel stub) ─────────────────────────────────────
  describe('resolveChannel', () => {
    it('APP reuses phone resolve; other channels → none (stub)', async () => {
      expect((await client.resolveChannel('APP', '+84987654321')).status).toBe('one');
      expect((await client.resolveChannel('ZALO', 'oa-user-1')).status).toBe('none');
    });
  });
});
