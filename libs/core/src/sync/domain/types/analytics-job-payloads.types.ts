/**
 * Analytics Sync Job Payloads (#2468, epic #2452 Phase 5)
 *
 * @module libs/core/src/sync/domain/types
 */

/**
 * Payload for `analytics.currency.recalculate` — the driver job behind the
 * Data Coverage panel's "Recalculate all N now" currency action.
 *
 * EVERY PIECE OF THE RUN'S STATE LIVES HERE OR IN THE LEDGER ROW, never in
 * worker memory. That is what makes "restarting the API mid-run does not lose
 * the run's state" true rather than aspirational: the ledger row
 * (`analytics_remediation_runs`) holds the lifecycle, and this payload holds
 * the scope, the enumeration cursor and the completion-poll counter. A
 * re-delivered or crash-replayed job reconstructs everything from the two.
 *
 * The scope is carried in the payload rather than as columns on the ledger
 * row because the Phase 1 Task 1.2 decision doc pins that table's shape and it
 * has no scope columns — and because `sync_jobs.payload` is exactly as durable
 * as a column would be.
 */
export interface AnalyticsCurrencyRecalculatePayloadV1 {
  schemaVersion: 1;
  /** The `analytics_remediation_runs` row this job advances. */
  runId: string;
  /** Range start, inclusive — ISO 8601. The operator's own coverage-panel window. */
  from: string;
  /** Range end, exclusive — ISO 8601. */
  to: string;
  /** Present only when the operator narrowed the panel to one channel. */
  sourceConnectionId?: string;
  /**
   * Keyset cursor into the mismatched population: the last `internalOrderId`
   * the previous page repaired, or absent/`null` to start from the beginning.
   *
   * Keyset rather than an offset because clearing a stamp leaves the row STILL
   * matching the mismatch predicate — see
   * `OrderRecordRepositoryPort.findCurrencyMismatchOrderRefsAfter`.
   */
  afterOrderId?: string | null;
  /**
   * How many completion polls have already been spent. Absent on the first
   * job; incremented on each self-reschedule once enumeration is exhausted.
   * Bounded so a population that never clears fails the run with a reason
   * instead of rescheduling forever.
   */
  pollCount?: number;
  /**
   * Monotonic step number, folded into the self-reschedule idempotency key.
   *
   * Required because `sync_jobs.idempotencyKey` is globally unique with no
   * TTL: a key built from `runId` alone would let the run advance exactly once
   * — the second reschedule would return the first job's row and the run would
   * stall silently at `in-progress` forever. Same trap #2039's `reconcileId`
   * closed for the offer-snapshot chain.
   */
  step?: number;
}

/**
 * Max completion polls before a run is declared `failed`.
 *
 * The poll only starts once every affected order has been cleared and
 * enqueued, so this bounds how long the run waits for the FX pipeline to
 * answer them — not how long enumeration takes. Twelve polls at the delay
 * below is roughly an hour, which comfortably covers the `realtime` lane
 * draining a few thousand stamp jobs plus one provider hiccup, while still
 * ending in an operator-readable reason rather than a run stuck at
 * `in-progress` indefinitely.
 */
export const ANALYTICS_CURRENCY_RECALCULATE_MAX_POLLS = 12;

/** Delay between completion polls, in seconds. */
export const ANALYTICS_CURRENCY_RECALCULATE_POLL_DELAY_SECONDS = 300;

/**
 * Idempotency key for one step of a run's driver chain.
 *
 * ONE FORMAT, TWO WRITERS — the API's initial enqueue (`step` 0) and the
 * handler's self-reschedule — so the two can never mint colliding or
 * accidentally-equal keys the way #2039's two `refreshSnapshot` writers once
 * could.
 */
export function buildAnalyticsCurrencyRecalculateIdempotencyKey(
  runId: string,
  step: number
): string {
  return `analytics:remediation:${runId}:step:${step}`;
}
