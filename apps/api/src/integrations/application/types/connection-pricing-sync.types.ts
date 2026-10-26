/**
 * Connection Pricing & Sync Types (#3146, ADR-072)
 *
 * @module apps/api/src/integrations/application/types
 */
import type { PriceSyncMode, PricingRule } from '@openlinker/core/identifier-mapping';

/**
 * The EFFECTIVE (override-then-default) mode + rule for a connection or a
 * (destination, source) pair. `rule: null` means "no rule configured" — the
 * master price passes through completely unchanged (`applyPricingRule`'s
 * `rule === null` arm: no rounding, no float cleanup). This is deliberately
 * NOT the same state as an explicit `{type: 'passthrough'}` rule, which DOES
 * apply rounding — see `readPricingRuleConfig`'s docblock. `buildView` must
 * never synthesize a passthrough rule to fill this gap (#3163 review,
 * finding 3): doing so on a connection that has never configured a rule
 * would silently switch rounding on the moment the operator next Saves the
 * page, with no visible change to what they typed.
 */
export interface ConnectionPricingSyncSetting {
  mode: PriceSyncMode;
  rule: PricingRule | null;
}

/**
 * A per-source override, as authored by the operator. Storage keeps the
 * `pricingRule` and `priceSyncMode` axes on `Connection.config` INDEPENDENT
 * (two separate `sourceOverrides` maps) — #3162's `optInAutomatic` writes
 * only the mode half — so this input mirrors that independence rather than
 * welding the two into one required pair (#3163 review, finding 5).
 *
 * `mode` absent = this source has no mode override (inherits the default).
 * `rule` absent OR `null` = this source has no rule override (inherits the
 * default) — `updatePricingSync` only writes a `pricingRule.sourceOverrides`
 * entry when `rule` is present AND non-null, so a client that echoes back a
 * `ConnectionPricingSyncSourceEntry` whose `ruleOverridden` was `false`
 * (rule taken from the default) can safely omit `rule` — or send it back as
 * `null` — without materializing an override nobody authored.
 */
export interface ConnectionPricingSyncSourceOverrideInput {
  mode?: PriceSyncMode;
  rule?: PricingRule | null;
}

export interface ConnectionPricingSyncSourceEntry {
  sourceConnectionId: string;
  sourceLabel: string;
  /** `true` when this source has its OWN mode override (`priceSyncMode.sourceOverrides`). */
  modeOverridden: boolean;
  /** `true` when this source has its OWN rule override (`pricingRule.sourceOverrides`). */
  ruleOverridden: boolean;
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
  sourceOverrides: Record<string, ConnectionPricingSyncSourceOverrideInput>;
  /**
   * Optimistic-concurrency guard (#3163 review, finding 7): when present,
   * `updatePricingSync` refuses the write with a 409 unless it still matches
   * the connection's persisted `updatedAt`. `Connection.config.pricingRule` /
   * `.priceSyncMode` are also written by #3162's `optInAutomatic` (accept/edit
   * "also set to Automatic") and by the review queue's per-row Undo, both from
   * OTHER call sites — this closes the lost-update window between this
   * page's GET and its Save.
   */
  expectedUpdatedAt?: string;
}

export interface ConnectionAsSourceEntry {
  destinationConnectionId: string;
  destinationLabel: string;
  effectiveMode: PriceSyncMode;
  effectiveRuleSummary: PricingRule | null;
  modeOverridden: boolean;
  ruleOverridden: boolean;
}
