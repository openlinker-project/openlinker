/**
 * Return Segment Types (#2378, `W2-41`, returns spec § 4.1)
 *
 * The six operator-facing **segments** of the returns list — the worklist strip
 * that answers *"what is stopping my day?"*.
 *
 * ## Segments OVERLAP. Stages PARTITION. Do not merge them.
 *
 * `ReturnStageCounts` (#2377) is a partition: six mutually exclusive buckets
 * that sum to the total, and an int-spec asserts `Σ byStage === total`. These
 * are the opposite shape — a single return can be `needs_disposition` **and**
 * `money_pending` **and** `orphans` at once, and `all_open` deliberately
 * overlaps almost everything.
 *
 * **There is therefore NO sum assertion, and there must never be one.** That is
 * said here, on the type, rather than only in a plan document, because the
 * sibling shape one file over asserts exactly the opposite and a reader copying
 * it is the likely failure.
 *
 * ## Ordered by what stops the operator's day
 *
 * Unlike `ReturnStageValues`, this array's order is **presentation order only**
 * — it is not an ordinal, nothing derives precedence from it, and each segment
 * is an independent predicate. Reordering changes the strip's layout and nothing
 * else.
 *
 * @module libs/core/src/returns/domain/types
 * @see docs/specs/product-spec-oms-returns-operator-ux.md § 4.1
 */

/**
 * The six segments, in strip order.
 *
 * - `needs_receiving` — custody `advised` / `in_transit`, or `received` with
 *   units still expected.
 * - `needs_disposition` — received units neither restocked nor scrapped.
 * - `restock_blocked` — a master write refused and nobody has attested.
 * - `money_pending` — money `pending` **or** `in_doubt` on any line.
 * - `orphans` — OpenLinker cannot name the order this return belongs to.
 * - `all_open` — still needing something on EITHER rail. See the note below.
 */
export const ReturnSegmentValues = [
  'needs_receiving',
  'needs_disposition',
  'restock_blocked',
  'money_pending',
  'orphans',
  'all_open',
] as const;

export type ReturnSegment = (typeof ReturnSegmentValues)[number];

/**
 * The two segments that may render a non-zero count in a danger tone.
 *
 * The #2100 attention-worthy/routine split: these two alone mean *OpenLinker did
 * something the operator has not been told about anywhere else*. `money_pending`
 * is routine on any active seller and is NEVER red — a warning tone on an
 * ordinary state teaches the operator to ignore the strip, which is the failure
 * the split exists to prevent.
 */
export const ATTENTION_WORTHY_RETURN_SEGMENTS: readonly ReturnSegment[] = [
  'restock_blocked',
  'orphans',
];

/** Pure coercion. No default — an unrecognised segment must never become another. */
export function isReturnSegment(value: unknown): value is ReturnSegment {
  return typeof value === 'string' && (ReturnSegmentValues as readonly string[]).includes(value);
}

/**
 * How many returns sit in each segment, over one filter scope.
 *
 * **`total` is NOT the sum of `bySegment`** — see the module docblock. It is the
 * row count of the segment-less scope, which is what the strip's `All returns`
 * card renders.
 */
export interface ReturnSegmentCounts {
  total: number;
  bySegment: Record<ReturnSegment, number>;
}
