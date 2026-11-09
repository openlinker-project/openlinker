/**
 * Price Rule Labels (#3147, #3873)
 *
 * Plain-language labels over the API's structured `ruleSummary`
 * ({type, percent, rounding}) - the frontend composes the sentence, since
 * `apps/web` cannot import `@openlinker/core` (#591) and the backend
 * deliberately returns structured data rather than a pre-composed string.
 * Every label reads the `price-changes` namespace at call time, so it
 * follows the active language.
 *
 * @module apps/web/src/features/price-changes/lib
 */
import { getMessages, interpolate } from '../../../shared/i18n';
import type {
  PriceChangeItem,
  PriceChangeRuleSummary,
  PriceSyncMode,
} from '../api/price-changes.types';
import type { PricingRule } from '../api/pricing-sync.types';

export type DeltaTone = 'up' | 'down' | 'flat' | 'steep';

/**
 * `PricingRule.percent`/`.rounding` are optional on the wire (#3148/#3146 -
 * a `passthrough` rule carries neither), but the label helpers need the
 * concrete shape; an `undefined` would otherwise render "undefined%". `0`/
 * `'none'` are the same defaults `pricing-and-sync-section.tsx`'s own
 * `toWireRule` falls back to.
 */
export function toRuleSummary(rule: PricingRule | null): PriceChangeRuleSummary {
  // No rule configured means the master price passes through unchanged, which
  // reads the same as a passthrough rule for display purposes.
  if (rule === null) return { type: 'passthrough', percent: 0, rounding: 'none' };
  return { type: rule.type, percent: rule.percent ?? 0, rounding: rule.rounding ?? 'none' };
}

/**
 * `|deltaPct| >= 10` is "steep" regardless of direction - matches the API's
 * `isSteep`. Ties the tone to the SAME rounded value `formatDeltaLabel`
 * renders (#3164 review): a change that rounds to a displayed `0%` is
 * "flat", never "down".
 */
export function deltaToneFor(item: Pick<PriceChangeItem, 'deltaPct' | 'isSteep'>): DeltaTone {
  if (item.isSteep) return 'steep';
  if (item.deltaPct === null) return 'flat';
  const rounded = Math.round(item.deltaPct);
  if (rounded === 0) return 'flat';
  return rounded > 0 ? 'up' : 'down';
}

/** `null` means there is no baseline to compute a delta against (a brand-new mapping's first detection). */
export function formatDeltaLabel(deltaPct: number | null): string {
  const copy = getMessages('price-changes').priceRuleLabels.delta;
  if (deltaPct === null) return copy.new;
  const rounded = Math.round(deltaPct);
  if (rounded === 0) return copy.flat;
  return interpolate(rounded > 0 ? copy.up : copy.down, { n: Math.abs(rounded) });
}

/**
 * The steep-chip tooltip. Never mentions margin, profit, or opportunity cost
 * (ADR-072 decision 6): there is no cost data in the catalogue to back it.
 */
export function steepDeltaTooltip(): string {
  return getMessages('price-changes').priceRuleLabels.steepTooltip;
}

export function ruleLabelFor(rule: PriceChangeRuleSummary): string {
  const copy = getMessages('price-changes').priceRuleLabels.ruleLabel;
  if (rule.type === 'passthrough') return copy.passthrough;
  return interpolate(rule.type === 'markup' ? copy.markup : copy.margin, { percent: rule.percent });
}

export function roundingLabelFor(rounding: PriceChangeRuleSummary['rounding']): string | null {
  const copy = getMessages('price-changes').priceRuleLabels.rounding;
  if (rounding === 'endingIn99') return copy.endingIn99;
  if (rounding === 'nearestWhole') return copy.nearestWhole;
  return null;
}

/**
 * The connection settings page's "Prices it so you keep a 22% margin, then
 * rounds up so it ends in .99." sentence - one whole sentence per rule type
 * and rounding mode, never composed from fragments.
 */
export function ruleSentenceFor(rule: PriceChangeRuleSummary): string {
  const sentences = getMessages('price-changes').priceRuleLabels.ruleSentence;
  const byType =
    rule.type === 'passthrough'
      ? sentences.passthrough
      : rule.type === 'markup'
        ? sentences.markup
        : sentences.margin;
  const sentence =
    rule.rounding === 'endingIn99'
      ? byType.endingIn99
      : rule.rounding === 'nearestWhole'
        ? byType.nearestWhole
        : byType.none;
  return interpolate(sentence, { percent: rule.percent });
}

/** "Automatic" / "Manual review" for a sync mode. */
export function syncModeLabelFor(mode: PriceSyncMode): string {
  const copy = getMessages('price-changes').priceRuleLabels.syncMode;
  return mode === 'automatic' ? copy.automatic : copy.manual;
}
