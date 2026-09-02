/**
 * Return Row — the derived operator stage (#2377, `W2-40`, spec § 3.2)
 *
 * The browser half of a rule implemented twice. The backend runs the same
 * ladder in SQL (`RETURN_STAGE_PREDICATES` / `RETURN_STAGE_EXPR` in
 * `ReturnRepository`) to count and filter; this derives the label for a row.
 *
 * ## Why twice, and what pins them
 *
 * The row already holds the counters, so re-asking the server for a string it
 * can compute would be a round trip for nothing — and a `stage` field on the
 * wire would leave nothing to mirror, which is the point of the exercise.
 * `scripts/check-return-stage-mirror.mjs` pins the vocabulary and the structure;
 * **meaning is pinned by the shared fixture table** (`RETURN_STAGE_FIXTURES`),
 * which the core spec and the SQL integration spec both consume.
 *
 * ## `advised` means STILL EXPECTED
 *
 * `expectedQuantity` subtracts the units on lines written off as never arriving.
 * Without it, a return with one line fully disposed and one marked
 * `not_returned` renders `Partially received` forever — a false statement about
 * work the operator has finished. Do not "simplify" this back to
 * `quantityAdvised`.
 *
 * @module apps/web/src/features/returns/lib
 */
import type { ReturnCounters, ReturnListItem } from '../api/returns.types';
import { RETURN_STAGE_VALUES, type ReturnStage } from './return-stage.types';

/** Units still expected to arrive. See the module docblock. */
export function expectedQuantity(counters: ReturnCounters): number {
  return counters.quantityAdvised - counters.notReturnedQuantityAdvised;
}

/** Units received but neither restocked nor scrapped. */
export function undisposedQuantity(counters: ReturnCounters): number {
  return counters.quantityReceived - (counters.quantityRestocked + counters.quantityScrapped);
}

/**
 * Derive the operator-facing stage. Pure — no clock, no I/O, no mutation.
 *
 * Arm for arm with core's `deriveReturnStage`, in the precedence order
 * `RETURN_STAGE_VALUES` declares.
 *
 * Takes the whole row rather than core's `(counters, facts)` pair, deliberately:
 * this module is the ROW's view model and every caller has an item in hand. A
 * future detail-page consumer — which holds lines and a record, not a
 * `ReturnListItem` — should widen this to the core pair rather than construct a
 * synthetic item.
 */
export function deriveReturnStage(item: ReturnListItem): ReturnStage {
  if (item.declinedAt !== null) return 'declined';

  const counters = item.counters;
  if (counters.lineCount > 0 && counters.notReturnedLineCount === counters.lineCount) {
    return 'not_returned';
  }

  const expected = expectedQuantity(counters);
  const received = counters.quantityReceived;

  // Outranks `disposed` deliberately: more units may still turn up, so calling a
  // partly-arrived return "Disposed" would say it is closed when it is not.
  if (received > 0 && received < expected) return 'partially_received';

  if (received >= expected && undisposedQuantity(counters) > 0) {
    return 'received_awaiting_disposition';
  }

  if (received > 0 && received >= expected) return 'disposed';

  return 'awaiting_parcel';
}

/**
 * Operator-facing labels.
 *
 * `satisfies Record<ReturnStage, string>` is the exhaustiveness gate — adding a
 * stage to the vocabulary without a label is a compile error rather than a blank
 * cell (the #2100 `invoicingBlockedBadge` precedent).
 */
export const RETURN_STAGE_LABELS = {
  declined: 'Declined',
  not_returned: 'Not returned',
  partially_received: 'Partially received',
  received_awaiting_disposition: 'Received — awaiting disposition',
  disposed: 'Disposed',
  awaiting_parcel: 'Awaiting parcel',
} as const satisfies Record<ReturnStage, string>;

/**
 * Tones.
 *
 * Only `declined` is toned — it is the one stage reporting that the SOURCE
 * refused something. Every other stage is a routine position in a return's life,
 * and colouring them would put warning tones on a healthy install's whole list,
 * which is the attention-worthy/routine split #2100 established.
 */
export const RETURN_STAGE_TONES = {
  declined: 'warning',
  not_returned: 'neutral',
  partially_received: 'neutral',
  received_awaiting_disposition: 'neutral',
  disposed: 'neutral',
  awaiting_parcel: 'neutral',
} as const satisfies Record<ReturnStage, 'neutral' | 'warning'>;

/**
 * The counter line rendered beside the stage — spec § 4.2's `3 of 5 received`.
 *
 * Reads the SAME aggregate the stage does, so the label and the number can never
 * disagree. Denominated in units STILL EXPECTED, for the same reason the stage
 * is: counting against a total that includes written-off units would show
 * `3 of 5` on a return where only three were ever coming.
 */
export function returnCounterLine(counters: ReturnCounters): string {
  return `${counters.quantityReceived} of ${expectedQuantity(counters)} received`;
}

/** The vocabulary, re-exported so a consumer needs one import. */
export { RETURN_STAGE_VALUES };
export type { ReturnStage };
