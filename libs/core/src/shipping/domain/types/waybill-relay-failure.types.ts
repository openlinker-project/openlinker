/**
 * Waybill Relay Failure Types (#2073)
 *
 * The vocabulary and the pure rules for "this shipment's waybill relay keeps
 * failing", plus the write shape the repository records one failure with.
 *
 * **Why this exists.** `ShipmentStatusSyncService.relayWaybillToParticipants`
 * releases its at-most-once claim on any transient participant failure so a
 * later poll tick retries (#1947). That is correct, and it has no terminal
 * case: a relay that fails on EVERY tick produces one `logger.error` per tick
 * forever while the job still reports `succeeded`. Nothing escalates, and the
 * marketplace silently never learns the order shipped. These types are how the
 * condition becomes a durable, operator-visible fact instead of a log line.
 *
 * **Scope — the waybill relay only.** Every name here is `waybillRelay*`
 * deliberately: this counts the ONE relay in the tree that retries forever and
 * reports only to the log. `ShipmentDispatchNotificationService` returns its
 * per-target outcomes to a caller that surfaces them immediately, so it is not
 * the "logs forever" shape and is not counted here. Do not widen these names to
 * imply the counter covers every relay kind.
 *
 * **This is NOT #861.** That issue is per-DESTINATION notify STATE — durable
 * per-target claim/retry state the relay branches on, so a permanently-broken
 * destination stops re-driving the source. Nothing here is that: the relay's
 * control flow is untouched, and `connectionId` below is a DISPLAY field with no
 * reader that gates anything (the #2100 discipline — a badge may render it, and
 * no gate may read it). When #861 lands its per-target model these become the
 * roll-up above it, or they are deleted; either way #861 is unconstrained.
 *
 * Pure by construction: no I/O, no injected dependency, no framework import, no
 * argument mutation — the `*.types.ts` pure-rule exception documented in
 * `docs/engineering-standards.md`, beside the `applyPricingRule` /
 * `applyStockSafetyBuffer` / `resolveOfferLifecycle` precedents. Each function
 * IS the rule for the type it sits with, and both halves change together.
 *
 * @module libs/core/src/shipping/domain/types
 */

/**
 * Why the last waybill relay attempt failed.
 *
 * A CLOSED vocabulary, and every member is reachable through the real service
 * path (`docs/lessons.md` § "A guard ordered behind a broader one is dead" —
 * a closed union is a claim that something can emit each member):
 *
 * - `'rejected'` — a participant's adapter refused the write.
 * - `'adapter-unresolved'` — the participant's adapter could not be built at
 *   all (disabled connection, credential failure). #1947 classifies this as
 *   TRANSIENT, which is why it releases the claim; the structural
 *   `no-capability` is NOT a failure and is deliberately absent here.
 * - `'threw'` — the relay threw before its per-target loop (identifier
 *   resolution), so no participant can be named.
 *
 * Deliberately carries no free-text detail — see
 * {@link RecordWaybillRelayFailureInput}.
 */
export const WaybillRelayFailureReasonValues = ['rejected', 'adapter-unresolved', 'threw'] as const;

export type WaybillRelayFailureReason = (typeof WaybillRelayFailureReasonValues)[number];

/**
 * Read-coercion for a persisted reason (#2100 discipline).
 *
 * A value this build does not recognise reads as ABSENT rather than being
 * asserted onward — the column is plain `text`, so a row written by a future
 * build, or by hand, must not surface as a reason the frontend cannot render.
 */
export function readWaybillRelayFailureReason(value: unknown): WaybillRelayFailureReason | null {
  return typeof value === 'string' &&
    (WaybillRelayFailureReasonValues as readonly string[]).includes(value)
    ? (value as WaybillRelayFailureReason)
    : null;
}

/**
 * What one failed relay attempt records.
 *
 * `failedAt` is supplied by the CALLER rather than stamped inside the
 * repository — the same shape `claimWaybillRelay(id, at)` already takes, which
 * keeps the instant testable. OL's own clock is the right authority here: OL
 * observed this failure itself, so unlike a channel-reported instant (#2336 /
 * #2367) there is no third party whose clock it would be standing in for.
 *
 * `connectionId` names the FIRST participant in the failing set, for display
 * only, and is `null` for `'threw'` (which happens before any participant is
 * known). It is never read to decide anything — see the header note on #861.
 */
export interface RecordWaybillRelayFailureInput {
  readonly reason: WaybillRelayFailureReason;
  readonly connectionId: string | null;
  readonly failedAt: Date;
}

/**
 * The failure history a `Shipment` carries, or `null` when it has none.
 *
 * `null` is the single representation of healthy (`count === 0`); the entity
 * never carries a zero-count object, so a caller tests one thing rather than two.
 */
export interface WaybillRelayFailure {
  /** Consecutive failed attempts. Reset to zero — i.e. to `null` — on success. */
  readonly count: number;
  /** When the current run of failures began. */
  readonly firstFailedAt: Date;
  /**
   * The most recent failure. This is what tells an ACTIVELY retrying relay
   * apart from a frozen historical one on a shipment that has since gone
   * terminal (the scan visits only non-terminal rows, so such a count stops
   * moving) — which is why it is carried even though the escalation predicate
   * does not read it.
   */
  readonly lastFailedAt: Date;
  /** Coerced on read; `null` when the stored value is unrecognised. */
  readonly reason: WaybillRelayFailureReason | null;
  /** Display only. `null` for `'threw'`, or when the stored value was absent. */
  readonly connectionId: string | null;
}

/**
 * How many consecutive failures make a relay operator-visible.
 *
 * Module-private, all three of them. Only {@link resolveWaybillRelayAlertThreshold}
 * may produce the number a caller uses — exporting the default would let a
 * second call site compare against it directly and reopen the
 * reported-versus-enforced gap the single resolver exists to close (#2229).
 */
const WAYBILL_RELAY_ALERT_THRESHOLD_DEFAULT = 3;

/**
 * The lower clamp is the load-bearing one. A threshold of `1` would escalate on
 * a single transient blip, which is precisely what #2073 AC-4 forbids — so the
 * clamp makes that unreachable rather than merely not the default.
 */
const WAYBILL_RELAY_ALERT_THRESHOLD_MIN = 2;

const WAYBILL_RELAY_ALERT_THRESHOLD_MAX = 100;

/**
 * Resolve the escalation threshold from `OL_WAYBILL_RELAY_FAILURE_ALERT_THRESHOLD`.
 *
 * Read by the API process only (the worker increments the counter and never
 * compares it), so the value is resolved ONCE per request at the HTTP boundary
 * and passed down — never re-read by the projection, or the filter and the badge
 * could disagree about what "stuck" means.
 *
 * A non-numeric, non-integer or non-finite value falls back to the default
 * rather than throwing: a mistyped env var must not take the shipments list down.
 */
export function resolveWaybillRelayAlertThreshold(raw: string | undefined): number {
  const parsed = Number(raw);
  if (raw === undefined || raw.trim() === '' || !Number.isFinite(parsed)) {
    return WAYBILL_RELAY_ALERT_THRESHOLD_DEFAULT;
  }
  const truncated = Math.trunc(parsed);
  return Math.min(
    WAYBILL_RELAY_ALERT_THRESHOLD_MAX,
    Math.max(WAYBILL_RELAY_ALERT_THRESHOLD_MIN, truncated),
  );
}

/**
 * The whole escalation predicate: a COUNT, never elapsed time.
 *
 * Cadence-independent by design — "N consecutive attempts could not tell the
 * marketplace" means the same thing on every deployment, whereas "stuck for two
 * hours" means a different number of attempts depending on the poll interval.
 */
export function isWaybillRelayStuck(
  failure: WaybillRelayFailure | null,
  threshold: number,
): boolean {
  return failure !== null && failure.count >= threshold;
}
