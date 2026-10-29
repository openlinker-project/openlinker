/**
 * Margin copy and formatting
 *
 * The one place the margin panel's wording lives: per gap reason (what is
 * left out and what the operator can do about it) and the ratio formatter.
 * Every string is operator language - no raw reason code is ever rendered.
 *
 * @module features/analytics/lib
 */
import type { MarginGap, MarginGapReason } from '../api/margin-analytics.types';

export interface MarginGapCopy {
  /** Row label in the coverage reasons table. */
  reason: string;
  /** What the operator can do about it. */
  action: string;
}

export const MARGIN_GAP_COPY: Record<MarginGapReason, MarginGapCopy> = {
  'no-cost': {
    reason: 'No cost recorded for the variant',
    action: 'Enter the cost on the product page.',
  },
  'cost-entered-after-sale': {
    reason: 'Ordered before the cost was entered',
    action: 'Nothing; new orders are covered.',
  },
  'no-variant': {
    reason: 'Order line not matched to a product variant',
    action: 'Match the order line to a product.',
  },
  'currency-mismatch': {
    reason: 'Cost currency differs from the order currency',
    action: 'Enter the cost in the currency the order was placed in.',
  },
};

/** 0.4331 -> "43.3%". `null` is the caller's to render as an absent value, never as "0%". */
export function formatRatio(ratio: number): string {
  return new Intl.NumberFormat(undefined, {
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
