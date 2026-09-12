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
import { ApiError } from '../../../shared/api/api-error';
import { minorUnitExponentFor } from '../../invoicing';
import type { PriceChangeItem, PriceChangeRuleSummary } from '../api/price-changes.types';
import type { PricingRule } from '../api/pricing-sync.types';

export type DeltaTone = 'up' | 'down' | 'flat' | 'steep';

/**
 * `PricingRule.percent`/`.rounding` are optional on the wire (#3148/#3146 —
 * a `passthrough` rule carries neither), but the two read-only pricing-sync
 * surfaces that render its label/sentence (`SourceConnectionPricingRollup`,
 * `PricingRulesPickerDialog`, #3150) need the concrete shape `ruleLabelFor`/
 * `ruleSentenceFor` require — an `undefined` fed into their template
 * literals would render the literal text "undefined%". `0`/`'none'` are the
 * same defaults `pricing-and-sync-section.tsx`'s own `toWireRule` falls
 * back to, so this is a no-op for every rule the backend actually sends
 * with concrete values (every non-passthrough rule, per that docblock).
 */
export function toRuleSummary(rule: PricingRule): PriceChangeRuleSummary {
  return { type: rule.type, percent: rule.percent ?? 0, rounding: rule.rounding ?? 'none' };
}

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

/**
 * Two-letter initials for an avatar chip (#3148 review, finding 8) —
 * extracted from `BulkAcceptPriceChangesDialog` so a second/third consumer
 * in this feature reuses one definition instead of drifting copies. Filters
 * empty tokens first, since a name with a leading/doubled space (`' Foo'`,
 * `'Foo  Bar'`) otherwise produces an empty-string initial from
 * `''[0]` and silently renders a blank chip.
 */
export function initialsFor(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/**
 * European-tolerant numeric parse for a manual price entry (#3148 review,
 * finding 7) — `Number(raw.replace(',', '.'))` only ever replaces the FIRST
 * comma, so a thousands-grouped value like `1 234,56` or `1.234,56` both
 * parse to `NaN` and surface the wrong "enter a price greater than 0" error
 * for an otherwise valid number on a PLN-denominated screen.
 *
 * Whitespace (a thousands separator, `1 234,56`) is stripped outright. When
 * both `,` and `.` appear, whichever occurs LAST is read as the decimal
 * separator and the other is treated as a thousands grouping mark. A lone
 * `.` or `,` appearing MORE than once (`1,234,567` / `1.234.567`) is
 * unambiguously a thousands grouping — a decimal separator occurs at most
 * once — and is stripped outright.
 *
 * **A lone separator occurring EXACTLY once, followed by EXACTLY 3 digits,
 * is genuinely ambiguous and is refused rather than guessed (#3148 second
 * review, still-open BLOCKING finding).** `"1,234"` reads identically
 * either as a thousands-grouped `1234` (the US/UK convention, and the exact
 * example the review names — an operator typing it expecting `1234` gets a
 * price ~1000× too low with nothing telling them) or as `1.234`, a
 * 3-decimal-place European reading. Treating it as decimal by default
 * — the previous fix's assumption, still visible in `isAmbiguousSeparator`'s
 * sibling reasoning below — silently reproduces the exact bug the review
 * called out. Refusing it is what `feedbackFor` surfaces as a distinct,
 * actionable error rather than a bare "enter a price greater than 0."
 */
function isAmbiguousSeparator(cleaned: string, separator: ',' | '.'): boolean {
  const occurrences = cleaned.split(separator).length - 1;
  if (occurrences !== 1) return false;
  const trailingDigits = cleaned.length - cleaned.indexOf(separator) - 1;
  return trailingDigits === 3;
}

export function parseLocalizedAmount(raw: string): number {
  const cleaned = raw.trim().replace(/\s/g, '');
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    const normalized =
      lastComma > lastDot
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
    return Number(normalized);
  }

  if (hasComma) {
    if (isAmbiguousSeparator(cleaned, ',')) return NaN;
    // A single `,` with anything OTHER than exactly 3 trailing digits is
    // unambiguous (`1,5`, `399,50`) and is read as the decimal separator;
    // more than one `,` (`1,234,567`) is unambiguous thousands grouping and
    // is stripped outright rather than replaced with `.` — the previous
    // shape replaced EVERY comma with `.`, turning `1,234,567` into the
    // syntactically invalid `1.234.567` and silently producing `NaN` for a
    // perfectly good number (found re-verifying #3167 against a fresh merge
    // of this branch's own #3165 fix).
    return Number(
      cleaned.split(',').length - 1 > 1 ? cleaned.replace(/,/g, '') : cleaned.replace(/,/g, '.')
    );
  }

  if (hasDot) {
    if (isAmbiguousSeparator(cleaned, '.')) return NaN;
    // A single `.` with anything OTHER than exactly 3 trailing digits is
    // unambiguous (`1.5`, `1.23`) and already a valid JS numeric literal;
    // more than one `.` (`1.234.567`) is unambiguous grouping and is
    // stripped.
    return Number(cleaned.split('.').length - 1 > 1 ? cleaned.replace(/\./g, '') : cleaned);
  }

  // `Number('')` is `0`, not `NaN` — an empty field must read as "no valid
  // amount" rather than a silently-accepted zero price (same re-verify
  // pass as the comma fix above).
  if (cleaned === '') return NaN;
  return Number(cleaned);
}

/**
 * The DB column backing a manual price override is `numeric(14,4)`, but the
 * currency the price actually publishes in almost always carries FEWER
 * decimal places than that (2 for PLN/EUR, 0 for a zero-decimal currency) —
 * clamping only to the storage column's precision let an operator confirm
 * e.g. `399.999` on a 2-decimal currency and be surprised by the extra digit
 * reappearing wherever the amount is next formatted (#3148 second review,
 * still-open BLOCKING finding). Clamping to the CURRENCY's own minor-unit
 * exponent — the same table `minorUnitExponentFor` already applies to a
 * shipping-tax split — is what shows the operator the number that will
 * actually be published, not merely one that survives the database column.
 */
export function clampToStorablePrecision(value: number, currency?: string | null): number {
  const exponent = minorUnitExponentFor(currency);
  const factor = 10 ** exponent;
  return Math.round(value * factor) / factor;
}

/**
 * Maps a price-change write failure to operator-facing copy (#3148 review,
 * finding 9). With a 30 s background poll and a per-dialog version snapshot,
 * a 409 (the episode changed again since it was opened) is a ROUTINE
 * outcome, not an edge case — the raw
 * `PriceChangeEpisodeStaleException`/`PriceChangeEpisodeBlockedException`
 * message strings are backend-internal prose (episode ids, raw version
 * tokens) that were otherwise surfacing verbatim in the toast. The raw error
 * still belongs in `console.error` for debugging; it must never reach the
 * toast.
 */
export function describePriceChangeActionError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isConflict()) {
      return "This price changed again while you were reviewing — refresh and take another look.";
    }
    if (error.status === 422) {
      if (error.message.includes('currency-mismatch')) {
        return "This price can't be published — the source and destination currencies don't match. Check the connection's currency settings.";
      }
      return "This price change is blocked and can't be published right now.";
    }
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}
