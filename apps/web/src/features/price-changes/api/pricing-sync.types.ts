/**
 * Pricing Sync API Types (#3146 backend contract, consumed by #3148's
 * "also set to Automatic" opt-in + its Undo)
 *
 * @module apps/web/src/features/price-changes/api
 */
import type { PriceRoundingMode, PriceSyncMode, PricingRuleType } from './price-changes.types';

export interface PricingRule {
  type: PricingRuleType;
  percent?: number;
  rounding?: PriceRoundingMode;
}

export interface PricingSyncSetting {
  mode: PriceSyncMode;
  /** `null` = no rule configured; the master price passes through unchanged. */
  rule: PricingRule | null;
}

export interface PricingSyncSourceEntry {
  sourceConnectionId: string;
  sourceLabel: string;
  isCustomOverride: boolean;
  effective: PricingSyncSetting;
  openEpisodeCount: number;
}

export interface ConnectionPricingSyncView {
  default: PricingSyncSetting;
  sources: PricingSyncSourceEntry[];
}

export interface UpdatePricingSyncInput {
  default: PricingSyncSetting;
  sourceOverrides: Record<string, PricingSyncSetting>;
}

/**
 * One destination-connection row of a SOURCE connection's read-only rollup
 * (`GET /connections/:id/pricing-sync/as-source`, #3150) — "how does each
 * place I sell adjust MY price".
 */
export interface ConnectionAsSourceEntry {
  destinationConnectionId: string;
  destinationLabel: string;
  effectiveMode: PriceSyncMode;
  /** `null` = no rule configured on the destination for this source. */
  effectiveRuleSummary: PricingRule | null;
  isCustomOverride: boolean;
}
