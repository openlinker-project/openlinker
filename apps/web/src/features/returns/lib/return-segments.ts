/**
 * Return Segments — the worklist strip (#2378, `W2-41`, spec § 4.1)
 *
 * Frontend mirror of the core `ReturnSegmentValues` vocabulary, hand-copied
 * because the browser bundle does not depend on `@openlinker/core`.
 *
 * ## Segments OVERLAP; stages PARTITION
 *
 * A return can sit in several segments at once, and `all_open` deliberately
 * overlaps almost everything — so the counts do **not** sum to the total, and
 * nothing here may assert that they do. The sibling stage shape is a partition
 * and does sum; do not copy its reasoning across.
 *
 * ## The strip has SEVEN cards
 *
 * `All returns` clears `segment` and is the default (unfiltered) state; the six
 * segments sit beside it, `All open` among them. `All open` is a **filter**, not
 * a clear — its predicate is "still needing something on either rail", so
 * rendering it as the clear card would label closed, fully-refunded returns as
 * open work.
 *
 * @module apps/web/src/features/returns/lib
 */
import type { MetricCardTone } from '../../../shared/ui/metric-card';
import { RETURN_RESTOCK_BLOCKED_COPY } from './restock-blocked.copy';

export const RETURN_SEGMENT_VALUES = [
  'needs_receiving',
  'needs_disposition',
  'restock_blocked',
  'money_pending',
  'orphans',
  'all_open',
] as const;

export type ReturnSegment = (typeof RETURN_SEGMENT_VALUES)[number];

/**
 * Coercion for an UNTRUSTED string — a hand-edited search param. An unrecognised
 * value is ignored rather than forwarded: the API validates `segment` with
 * `@IsIn`, so passing junk through would 400 the whole page over a URL typo.
 */
export function isReturnSegment(value: string | null | undefined): value is ReturnSegment {
  return (
    value !== null &&
    value !== undefined &&
    (RETURN_SEGMENT_VALUES as readonly string[]).includes(value)
  );
}

/** Operator-facing labels, verbatim from spec § 4.1. */
export const RETURN_SEGMENT_LABELS = {
  needs_receiving: 'Needs receiving',
  needs_disposition: 'Needs disposition',
  // The one segment whose label is NOT authored here (#2645 review). It is the
  // same sentence the row badge and the per-line notice render, so it lives in
  // `restock-blocked.copy.ts` with them — a second literal is exactly the drift
  // that module exists to prevent, and its own docblock already claims this
  // segment as a consumer.
  restock_blocked: RETURN_RESTOCK_BLOCKED_COPY.badge,
  money_pending: 'Money pending',
  orphans: 'Orphans',
  all_open: 'All open',
} as const satisfies Record<ReturnSegment, string>;

/**
 * Tones — keyed off `MetricCard`'s OWN prop type, never a local union.
 *
 * A locally-declared tone union type-checks against a tone the primitive does
 * not render, which is the same class of defect as a mirror that drifts.
 *
 * **Only `restock_blocked` and `orphans` may be red** (the #2100
 * attention-worthy/routine split): both mean *OpenLinker did something the
 * operator has not been told about anywhere else*. `money_pending` is routine on
 * any active seller and is never red — a warning tone on an ordinary state
 * teaches the operator to ignore the strip.
 */
export const RETURN_SEGMENT_TONES = {
  needs_receiving: 'warning',
  needs_disposition: 'warning',
  restock_blocked: 'error',
  money_pending: 'warning',
  orphans: 'error',
  // NEUTRAL, per spec § 4.1 — and load-bearing rather than cosmetic. `all_open`
  // overlaps almost everything, so it is the largest card on any active install;
  // toning it would put colour at the front of the strip on every healthy
  // install, which is the "teaches the operator to ignore the strip" failure the
  // attention/routine split exists to prevent.
  all_open: 'neutral',
} as const satisfies Record<ReturnSegment, MetricCardTone>;

/** The two segments that may render a non-zero count in a danger tone. */
export const ATTENTION_WORTHY_RETURN_SEGMENTS: readonly ReturnSegment[] = [
  'restock_blocked',
  'orphans',
];

export interface ReturnSegmentCounts {
  /** Rows in the segment-less scope. **NOT** the sum of `bySegment`. */
  total: number;
  bySegment: Record<ReturnSegment, number>;
}
