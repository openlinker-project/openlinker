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
  /** `true` when this source has its OWN sync-mode override. */
  modeOverridden: boolean;
  /** `true` when this source has its OWN pricing-rule override. */
  ruleOverridden: boolean;
  effective: PricingSyncSetting;
  openEpisodeCount: number;
}

export interface ConnectionPricingSyncView {
  default: PricingSyncSetting;
  sources: PricingSyncSourceEntry[];
}

/**
 * A per-source override as written. The two axes are independent: `mode`
 * absent = no mode override; `rule` absent or `null` = no rule override (the
 * source inherits the default rule). A mode-only override must therefore omit
 * `rule` rather than copy the default in, which would freeze it (#3729).
 */
export interface PricingSyncSourceOverride {
  mode?: PriceSyncMode;
  rule?: PricingRule | null;
}

export interface UpdatePricingSyncInput {
  default: PricingSyncSetting;
  sourceOverrides: Record<string, PricingSyncSourceOverride>;
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
  modeOverridden: boolean;
  ruleOverridden: boolean;
}
