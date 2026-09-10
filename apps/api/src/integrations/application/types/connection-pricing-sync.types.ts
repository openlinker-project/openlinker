/**
 * Connection Pricing & Sync Types (#3146, ADR-072)
 *
 * @module apps/api/src/integrations/application/types
 */
import type { PriceSyncMode, PricingRule } from '@openlinker/core/identifier-mapping';

export interface ConnectionPricingSyncSetting {
  mode: PriceSyncMode;
  rule: PricingRule;
}

export interface ConnectionPricingSyncSourceEntry {
  sourceConnectionId: string;
  sourceLabel: string;
  /** `true` when this source has its own rule/mode; `false` = uses the connection's default. */
  isCustomOverride: boolean;
  /** The EFFECTIVE (override-then-default) setting. */
  effective: ConnectionPricingSyncSetting;
  openEpisodeCount: number;
}

export interface ConnectionPricingSyncView {
  default: ConnectionPricingSyncSetting;
  sources: ConnectionPricingSyncSourceEntry[];
}

export interface UpdateConnectionPricingSyncInput {
  default: ConnectionPricingSyncSetting;
  sourceOverrides: Record<string, ConnectionPricingSyncSetting>;
}

export interface ConnectionAsSourceEntry {
  destinationConnectionId: string;
  destinationLabel: string;
  effectiveMode: PriceSyncMode;
  effectiveRuleSummary: PricingRule;
  isCustomOverride: boolean;
}
