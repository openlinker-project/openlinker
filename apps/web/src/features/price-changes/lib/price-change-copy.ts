/**
 * Price Change Copy (#3147)
 *
 * Plain-language composition over the API's structured `ruleSummary`
 * ({type, percent, rounding}) — the frontend composes the sentence, since
 * `apps/web` cannot import `@openlinker/core` (#591) and the backend
 * deliberately returns structured data rather than a pre-composed string
 * (`price-change-queue-item.types.ts`'s own docblock).
 *
 * @module apps/web/src/features/price-changes/lib
 */
import type { PriceChangeItem, PriceChangeRuleSummary } from '../api/price-changes.types';

export type DeltaTone = 'up' | 'down' | 'steep';

/** `|deltaPct| >= 10` is "steep" regardless of direction — matches the API's `isSteep`. */
export function deltaToneFor(item: Pick<PriceChangeItem, 'deltaPct' | 'isSteep'>): DeltaTone {
  if (item.isSteep) return 'steep';
  return item.deltaPct > 0 ? 'up' : 'down';
}

export function formatDeltaLabel(deltaPct: number): string {
  const rounded = Math.round(deltaPct);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

/**
 * The steep-chip tooltip. Verbatim per the mockup — never mentions margin,
 * profit, or opportunity cost (ADR-072 decision 7): there is no cost/COGS
 * data anywhere in the catalogue to back such a claim.
 */
export const STEEP_DELTA_TOOLTIP = 'Big price change - worth a second look';

export function ruleLabelFor(rule: PriceChangeRuleSummary): string {
  if (rule.type === 'passthrough') {
    return 'no adjustment';
  }
  return `${rule.percent}% ${rule.type}`;
}

export function roundingLabelFor(rounding: PriceChangeRuleSummary['rounding']): string | null {
  if (rounding === 'endingIn99') return 'ending in .99';
  if (rounding === 'nearestWhole') return 'nearest whole';
  return null;
}

/** The connection settings page's "Prices it so you keep a 22% margin, then rounds..." sentence. */
export function ruleSentenceFor(rule: PriceChangeRuleSummary): string {
  const roundingLabel = roundingLabelFor(rule.rounding);
  if (rule.type === 'passthrough') {
    return roundingLabel
      ? `Uses the shop price as-is, rounded to ${roundingLabel}.`
      : 'Uses the shop price as-is.';
  }
  const verb = rule.type === 'markup' ? 'Adds' : 'Keeps';
  const noun = rule.type === 'markup' ? 'on top of the shop price' : 'as a margin';
  const base = `${verb} a ${rule.percent}% ${rule.type === 'markup' ? 'markup' : 'margin'} ${noun}`;
  return roundingLabel ? `${base}, then rounds so it ends in ${roundingLabel}.` : `${base}.`;
}
