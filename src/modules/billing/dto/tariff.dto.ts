/**
 * Tariff DTOs — Zod Schemas + TypeScript Types
 *
 * AC#1: Tariff Plan (tiered pricing table — bậc thang)
 * AC#2: Tariff Breakdown (invoice-specific tier breakdown with subtotals)
 * AC#3: Applicable Fees (environmental, drainage, VAT, surcharges)
 */

import { z } from 'zod';

// =============================================================================
// AC#1: Tariff Plan (tiered pricing table)
// =============================================================================

export const TariffTierSchema = z.object({
  tier: z.number().int().positive(), // Tier number (1, 2, 3, 4)
  fromVolume: z.number().nonnegative(), // m³ start of tier
  toVolume: z.number().nullable(), // m³ end of tier (null = unlimited)
  pricePerM3: z.number().positive(), // VND per m³
});

export const TariffPlanSchema = z.object({
  planId: z.string(),
  planName: z.string(), // e.g. "Bậc thang sinh hoạt"
  customerType: z.enum(['residential', 'industrial', 'commercial', 'institutional']),
  applicableContractId: z.string(),
  tiers: z.array(TariffTierSchema).min(1),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
});

// =============================================================================
// AC#2: Tariff Breakdown (invoice-specific)
// =============================================================================

export const TariffBreakdownTierSchema = z.object({
  tier: z.number().int().positive(),
  fromVolume: z.number().nonnegative(),
  toVolume: z.number().nullable(),
  volume: z.number().nonnegative(), // m³ consumed in this tier
  pricePerM3: z.number().positive(), // VND per m³
  subtotal: z.number().nonnegative(), // volume × pricePerM3
});

export const TariffBreakdownSchema = z.object({
  invoiceId: z.string(),
  contractId: z.string(),
  tiers: z.array(TariffBreakdownTierSchema),
  totalBeforeFees: z.number().nonnegative(),
});

// =============================================================================
// AC#3: Applicable Fees
// =============================================================================

export const ApplicableFeeSchema = z.object({
  feeType: z.enum(['environmental', 'drainage', 'vat', 'surcharge']),
  feeName: z.string(), // Display name e.g. "Phí bảo vệ môi trường"
  rate: z.number().nonnegative(), // percentage or fixed amount
  isPercentage: z.boolean(), // true = rate is %, false = fixed VND
});

export const ApplicableFeesResponseSchema = z.object({
  contractId: z.string(),
  fees: z.array(ApplicableFeeSchema),
  vatPercentage: z.number().nonnegative(), // e.g. 5 (means 5%)
});

// =============================================================================
// Input Validation
// =============================================================================

export const ContractIdParamSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9-_]+$/, 'Invalid Contract ID format');
// InvoiceIdParamSchema — defined in invoice.dto.ts (single source of truth)

// =============================================================================
// TypeScript Types
// =============================================================================

export type TariffTier = z.infer<typeof TariffTierSchema>;
export type TariffPlan = z.infer<typeof TariffPlanSchema>;
export type TariffBreakdownTier = z.infer<typeof TariffBreakdownTierSchema>;
export type TariffBreakdown = z.infer<typeof TariffBreakdownSchema>;
export type ApplicableFee = z.infer<typeof ApplicableFeeSchema>;
export type ApplicableFeesResponse = z.infer<typeof ApplicableFeesResponseSchema>;
