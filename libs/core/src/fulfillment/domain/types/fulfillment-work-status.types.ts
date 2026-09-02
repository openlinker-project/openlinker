/**
 * Fulfillment Work Status — the EXECUTION axis (#2391, ADR-054)
 *
 * How far the physical work has got. This is one of **two orthogonal axes** a
 * `FulfillmentWork` carries; the other is `FulfillmentRequestStatus` (the
 * NEGOTIATION axis, in its own file beside this one).
 *
 * **They are separate because collapsing them produces the "cancel is a
 * command" bug** (ADR-054 § Alternatives, DESIGN §5.2): cancelling work a
 * holder has already ACCEPTED is a negotiation with that holder, not an
 * instruction to it. A single merged axis has to answer "cancelled" with one
 * value and therefore has to lie about one of the two questions. The split
 * mirrors ADR-007's status-vs-outcome rule one layer up.
 *
 * The seven members are DESIGN-VERBATIM — DESIGN §5.2 lists this array
 * literally:
 *
 *     FulfillmentWorkStatusValues = ['open','scheduled','on_hold','in_progress',
 *                                    'closed','cancelled','incomplete'];
 *
 * One member per line, no computed keys: the mirror-script family in this repo
 * reads these arrays TEXTUALLY (see `scripts/check-*-mirror.mjs`), so a
 * `.map()` or a spread would defeat a future mirror before it is written.
 *
 * @module libs/core/src/fulfillment/domain/types
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.2
 */

export const FulfillmentWorkStatusValues = [
  /** Created and not yet scheduled or offered to a holder. The initial state. */
  'open',
  /**
   * Planned for execution but not started. Reached by the `schedule` action.
   * On an `omp_fulfilled` topology work is observation-only (DESIGN §5.1) and
   * may never leave `open`.
   */
  'scheduled',
  /**
   * Suspended by a first-class hold row (`fulfillment_holds`, #2392), which
   * carries the reason. The reason vocabulary is `HoldReason` and lives in the
   * `order-lifecycle` leaf — ONE vocabulary, two hold grains (design
   * adjudication #4); it is deliberately not restated here.
   */
  'on_hold',
  /** A holder is actively picking, packing or otherwise working the item. */
  'in_progress',
  /**
   * Finished. Never used for a force-close — ADR-054 requires that to land on
   * `cancelled`, "never `closed`-as-completed", so the two stay distinguishable
   * in the record.
   */
  'closed',
  /**
   * Ended without completing. Always accompanied by a
   * `FulfillmentCancellationReason` (the `cancellationReason` field), including
   * the audited operator force-close whose reason is `operator_forced`.
   */
  'cancelled',
  /**
   * Closed for a SHORTFALL rather than for the full quantity — the
   * `short_picked` + `releaseShortfall` path (DESIGN §5.4), which closes the
   * shortfall `incomplete` and re-enters routing with the rejecter blocked.
   *
   * Entered by a PROGRESS EVENT, not by an action; see the note on
   * `FulfillmentWorkActionValues`.
   */
  'incomplete',
] as const;

export type FulfillmentWorkStatus = (typeof FulfillmentWorkStatusValues)[number];

/** Narrow an untrusted value (a persisted column, a request DTO) to a `FulfillmentWorkStatus`. */
export function isFulfillmentWorkStatus(value: unknown): value is FulfillmentWorkStatus {
  return (
    typeof value === 'string' && (FulfillmentWorkStatusValues as readonly string[]).includes(value)
  );
}
