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

export type DeltaTone = 'up' | 'down' | 'flat' | 'steep';

/**
 * `|deltaPct| >= 10` is "steep" regardless of direction — matches the API's
 * `isSteep`. Ties the tone to the SAME rounded value `formatDeltaLabel`
 * renders (#3164 review): a tiny change like `-0.4%` rounds to a displayed
 * `0%`, and basing the tone on the *unrounded* sign would render a chip that
 * reads "0%" while colored as a decrease — an internal contradiction. A
 * rounded `0` (also reachable for real via #3159's first-time-mapping fix,
 * which persists `computedOldAmount: 0`/`deltaPct: 0`) is "flat", never
 * "down".
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
  if (deltaPct === null) return 'New';
  const rounded = Math.round(deltaPct);
  if (rounded === 0) return '0%';
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

/**
 * The steep-chip tooltip. Verbatim per the mockup — never mentions margin,
 * profit, or opportunity cost (ADR-072 decision 6): there is no cost/COGS
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

/**
 * The rounding half of `ruleSentenceFor`'s sentence, phrased as a clause that
 * follows "…, " rather than as a noun phrase to be prefixed with "ends in" —
 * `roundingLabelFor` already returns a full prepositional phrase
 * (`'ending in .99'`), so prefixing it with "ends in" produced the
 * stuttering "ends in ending in .99" (#3164 review). `nearestWhole` needed
 * its own clause rather than reusing "ends in" at all, since "ends in
 * nearest whole" misstates the rounding mode.
 */
function roundingClauseFor(rounding: PriceChangeRuleSummary['rounding']): string | null {
  if (rounding === 'endingIn99') return 'then rounds up so it ends in .99';
  if (rounding === 'nearestWhole') return 'then rounds to the nearest whole number';
  return null;
}

/**
 * The connection settings page's "Prices it so you keep a 22% margin, then
 * rounds up so it ends in .99." sentence (verbatim per the mockup).
 */
export function ruleSentenceFor(rule: PriceChangeRuleSummary): string {
  const clause = roundingClauseFor(rule.rounding);
  if (rule.type === 'passthrough') {
    return clause ? `Uses the shop price as-is, ${clause}.` : 'Uses the shop price as-is.';
  }
  const verb = rule.type === 'markup' ? 'add' : 'keep';
  const noun = rule.type === 'markup' ? 'markup' : 'margin';
  const base = `Prices it so you ${verb} a ${rule.percent}% ${noun}`;
  return clause ? `${base}, ${clause}.` : `${base}.`;
}
