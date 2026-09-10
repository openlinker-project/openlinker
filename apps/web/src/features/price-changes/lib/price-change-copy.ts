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
 * separator and the other is treated as a thousands grouping mark; when only
 * `,` appears, it is read as the decimal separator (the common European
 * convention this dialog is aimed at). A lone `.` needs no rewriting.
 */
export function parseLocalizedAmount(raw: string): number {
  let cleaned = raw.trim().replace(/\s/g, '');
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    cleaned =
      lastComma > lastDot
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  } else if (lastComma !== -1) {
    cleaned = cleaned.replace(',', '.');
  }

  return Number(cleaned);
}

/**
 * The DB column backing a manual price override is `numeric(14,4)` — a
 * value carrying more than 4 decimal places publishes successfully and is
 * silently truncated server-side. Clamping here means the operator sees the
 * value that will actually be stored, rather than being surprised by a
 * truncation nothing told them about (#3148 review, finding 7).
 */
export function clampToStorablePrecision(value: number): number {
  return Math.round(value * 10_000) / 10_000;
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
