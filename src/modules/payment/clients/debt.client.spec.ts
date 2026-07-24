import { MockDebtAdapter } from './debt.client';
import {
  OutstandingDebtResponseSchema,
  DebtHistoryResponseSchema,
  AgingBucketSchema,
  AgingBreakdownSchema,
  DebtEntrySchema,
  DebtHistoryEntrySchema,
} from '../dto/debt.dto';

describe('MockDebtAdapter', () => {
  let adapter: MockDebtAdapter;

  beforeEach(() => {
    adapter = new MockDebtAdapter();
  });

  // ── AC#1: get-outstanding-debt ──────────────────────────────────────────────

  describe('execute - get-outstanding-debt', () => {
    it('should read and validate get-outstanding-debt.json mock data', async () => {
      const result = await adapter.execute('get-outstanding-debt', {
        customerId: 'USR-001',
      });

      expect(result).toBeDefined();
      const parsed = OutstandingDebtResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.totalAmount).toBeGreaterThan(0);
        expect(parsed.data.debts).toBeInstanceOf(Array);
        expect(parsed.data.debts.length).toBeGreaterThan(0);
        expect(parsed.data.totalCount).toBeGreaterThan(0);
      }
    });

    it('should have aging breakdown with all four buckets', async () => {
      const result = await adapter.execute('get-outstanding-debt', { customerId: 'USR-001' });
      const parsed = OutstandingDebtResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        const { agingBreakdown } = parsed.data;
        expect(agingBreakdown.current).toBeDefined();
        expect(agingBreakdown['31-60']).toBeDefined();
        expect(agingBreakdown['61-90']).toBeDefined();
        expect(agingBreakdown['>90']).toBeDefined();
      }
    });

    it('should have valid debt entries with aging buckets', async () => {
      const result = await adapter.execute('get-outstanding-debt', { customerId: 'USR-001' });
      const parsed = OutstandingDebtResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        for (const debt of parsed.data.debts) {
          expect(debt.invoiceRef).toBeDefined();
          expect(debt.amount).toBeGreaterThan(0);
          expect(debt.dueDate).toBeDefined();
          expect(debt.daysOverdue).toBeGreaterThanOrEqual(0);
          expect(['current', '31-60', '61-90', '>90']).toContain(debt.agingBucket);
        }
      }
    });
  });

  // ── AC#2: get-debt-history ──────────────────────────────────────────────────

  describe('execute - get-debt-history', () => {
    it('should read and validate get-debt-history.json mock data', async () => {
      const result = await adapter.execute('get-debt-history', {
        customerId: 'USR-001',
      });

      expect(result).toBeDefined();
      const parsed = DebtHistoryResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.entries).toBeInstanceOf(Array);
        expect(parsed.data.entries.length).toBeGreaterThan(0);
        expect(parsed.data.totalCount).toBeGreaterThan(0);
      }
    });

    it('should have entries with valid statuses', async () => {
      const result = await adapter.execute('get-debt-history', { customerId: 'USR-001' });
      const parsed = DebtHistoryResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        for (const entry of parsed.data.entries) {
          expect(entry.invoiceRef).toBeDefined();
          expect(entry.amount).toBeGreaterThanOrEqual(0);
          expect(entry.dueDate).toBeDefined();
          expect(['outstanding', 'paid', 'written_off']).toContain(entry.status);
        }
      }
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────────

  describe('execute - missing method', () => {
    it('should throw for missing mock file', async () => {
      await expect(adapter.execute('nonexistent', {})).rejects.toThrow();
    });
  });

  // ── Zod schema validation ──────────────────────────────────────────────────

  describe('Zod schema validation', () => {
    it('AgingBucketSchema should accept valid buckets', () => {
      for (const bucket of ['current', '31-60', '61-90', '>90']) {
        expect(AgingBucketSchema.safeParse(bucket).success).toBe(true);
      }
    });

    it('AgingBucketSchema should reject invalid bucket', () => {
      expect(AgingBucketSchema.safeParse('0-10').success).toBe(false);
    });

    it('AgingBreakdownSchema should reject missing bucket', () => {
      const result = AgingBreakdownSchema.safeParse({
        current: 100,
        '31-60': 50,
        '61-90': 25,
        // missing '>90'
      });
      expect(result.success).toBe(false);
    });

    it('DebtEntrySchema should reject negative daysOverdue', () => {
      const result = DebtEntrySchema.safeParse({
        invoiceRef: 'INV-001',
        amount: 100,
        dueDate: '2026-01-01',
        daysOverdue: -1,
        agingBucket: 'current',
      });
      expect(result.success).toBe(false);
    });

    it('DebtHistoryEntrySchema should accept null paidDate', () => {
      const result = DebtHistoryEntrySchema.safeParse({
        invoiceRef: 'INV-001',
        amount: 100,
        dueDate: '2026-01-01',
        paidDate: null,
        status: 'outstanding',
        agingAtPayment: null,
      });
      expect(result.success).toBe(true);
    });

    it('DebtHistoryEntrySchema should reject invalid status', () => {
      const result = DebtHistoryEntrySchema.safeParse({
        invoiceRef: 'INV-001',
        amount: 100,
        dueDate: '2026-01-01',
        paidDate: null,
        status: 'unknown',
        agingAtPayment: null,
      });
      expect(result.success).toBe(false);
    });

    it('OutstandingDebtResponseSchema should reject negative totalAmount', () => {
      const result = OutstandingDebtResponseSchema.safeParse({
        totalAmount: -100,
        agingBreakdown: { current: 0, '31-60': 0, '61-90': 0, '>90': 0 },
        debts: [],
        totalCount: 0,
      });
      expect(result.success).toBe(false);
    });
  });
});
