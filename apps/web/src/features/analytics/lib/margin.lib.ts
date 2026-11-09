/**
 * Margin helpers
 *
 * The margin panel's ratio formatter, gap totals and the per-reason copy
 * lookup. The wording itself lives in the `analytics` namespace
 * (`marginCopy.gaps`); every string is operator language - no raw reason code
 * is ever rendered.
 *
 * @module features/analytics/lib
 */
import { getMessages } from '../../../shared/i18n';
import { getLocale } from '../../../shared/i18n/active-locale';
import { getBcp47Locale } from '../../../shared/i18n/locale';
import type { MarginGap, MarginGapReason } from '../api/margin-analytics.types';

export interface MarginGapCopy {
  /** Row label in the coverage reasons table. */
  reason: string;
  /** What the operator can do about it. */
  action: string;
}

/** The operator wording for one gap reason, read at call time. */
export function marginGapCopy(reason: MarginGapReason): MarginGapCopy {
  const gaps = getMessages('analytics').marginCopy.gaps;
  switch (reason) {
    case 'no-cost':
      return gaps.noCost;
    case 'cost-entered-after-sale':
      return gaps.costEnteredAfterSale;
    case 'no-variant':
      return gaps.noVariant;
    case 'currency-mismatch':
      return gaps.currencyMismatch;
  }
}

/** 0.4331 -> "43.3%". `null` is the caller's to render as an absent value, never as "0%". */
export function formatRatio(ratio: number): string {
  return new Intl.NumberFormat(getBcp47Locale(getLocale()), {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(ratio);
}

export interface MarginGapTotals {
  lineCount: number;
  netAmount: number;
  /** Only the reasons that actually left lines out, in the API's order. */
  gaps: MarginGap[];
}

export function totalMarginGaps(gaps: readonly MarginGap[]): MarginGapTotals {
  const present = gaps.filter((gap) => gap.lineCount > 0);
  return {
    lineCount: present.reduce((sum, gap) => sum + gap.lineCount, 0),
    netAmount: present.reduce((sum, gap) => sum + gap.netAmount, 0),
    gaps: present,
  };
}

/**
 * True when nothing in the range has a cost at all: no covered revenue, no
 * cost of goods, and every gap is "no cost" or "no variant". A range that
 * merely has no sales is NOT this state - there is nothing to be missing.
 */
export function isNoCostAtAll(
  headline: { netRevenue: number; coveredNetRevenue: number; costOfGoods: number; gaps: readonly MarginGap[] }
): boolean {
  if (headline.netRevenue <= 0) return false;
  if (headline.coveredNetRevenue !== 0 || headline.costOfGoods !== 0) return false;
  return headline.gaps.every(
    (gap) => gap.lineCount === 0 || gap.reason === 'no-cost' || gap.reason === 'no-variant'
  );
}
