/**
 * Dispatch-Relay Reconcile — the pure rules (#2728, ADR-054)
 *
 * #2401 made the dispatch-relay claim RELEASABLE, so a transiently-failed relay
 * hands `dispatchRelayedAt` back. That is necessary and it is not sufficient:
 * releasing the slot causes no retry by itself. `IFulfillmentProgressService.record`
 * burns the `(workId, idempotencyKey)` claim BEFORE reporting the relay intent and
 * returns **no** intent for a duplicate, so replaying the same vendor event produces
 * nothing to re-drive; only a later, DIFFERENTLY-KEYED event would — and if the
 * holder's next event is `delivered` rather than a second `shipped`, the dispatch
 * relay is simply never sent. `IFulfillmentRelayGateService.releaseDispatch` states
 * the window is narrower still: a second event arriving WHILE the first relay is
 * failing sees the claim held, answers `already-relayed`, and recovery then needs a
 * THIRD event.
 *
 * So the recovery has to come from a source other than the event stream. This file
 * holds the three pure rules that source needs; the read is
 * `FulfillmentWorkRepositoryPort.listUnrelayedShippedDispatches`, the orchestration
 * is `FulfillmentRelayReconcileService`, and the re-drive is the UNCHANGED
 * `IFulfillmentDispatchRelayService.relayDispatch`, which already goes through
 * `claimDispatchRelay`.
 *
 * ## The `*.types.ts` pure-rule exception applies
 *
 * `engineering-standards.md § The pure-rule exception to "types only"` permits
 * runtime functions in a `*.types.ts` when they are pure, they ARE the rule for the
 * type beside them, and both halves change together. All three qualify: no I/O, no
 * injected dependency, no clock of their own, no argument mutation. The shipped
 * precedents are `applyPricingRule`, `applyStockSafetyBuffer`, `resolveOfferLifecycle`
 * and — one issue earlier, in this same directory —
 * `resolveFulfillmentDispatchTimeoutMs`.
 *
 * ## What must NOT be built here, and why the claim is left burnt
 *
 * The obvious "fix" is to release the `(workId, idempotencyKey)` progress claim
 * alongside `dispatchRelayedAt`, which would make the retry literal. It reverses
 * #2400's core design: that key is **permanent memory**, not a held slot, argued
 * explicitly there against the partial-unique precedents (`reservations` on
 * `status = 'held'`, `order_changes` on the open statuses), both of which are
 * partial because they express SLOT-HOLDING. Un-burning it lets a replayed vendor
 * event re-move counters — trading a missed relay for corrupted quantities, which
 * is strictly the worse failure. `__tests__/no-progress-claim-release.spec.ts` fails
 * the build if any release is ever added.
 *
 * @module libs/core/src/fulfillment/domain/types
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 */

/**
 * How long a work may sit shipped-but-unrelayed before the sweep will touch it.
 *
 * **A grace window is required rather than defensive.** The ordinary path burns the
 * progress claim and only then relays, so `dispatchRelayedAt IS NULL` is a
 * legitimate, expected state for the whole duration of a live relay. The claim's
 * conditional UPDATE already makes a race SAFE — exactly one of two triggers wins —
 * but with no grace the sweep would contend with every single live `shipped` event
 * and turn a healthy install's log into a stream of `already-relayed`, which is the
 * noise that stops an operator reading the counts that matter.
 */
const RELAY_GRACE_DEFAULT_MS = 15 * 60 * 1000;

/**
 * The floor is the safety bound. Below roughly a minute the sweep starts racing
 * relays that are still in flight; that costs no correctness (the claim decides)
 * but it spends outbound adapter calls on work already being done.
 */
const RELAY_GRACE_MIN_MS = 60 * 1000;
const RELAY_GRACE_MAX_MS = 24 * 60 * 60 * 1000;

/**
 * How long a work may stay shipped-but-unrelayed before it is ESCALATED.
 *
 * This is the issue's decision 4 — "whether an age bound is needed so a permanently
 * unrelayable work becomes observable rather than retried forever" — and the answer
 * is yes, for #2346's reason: a sweep that re-drives the same candidate every tick
 * with nothing accumulating produces one log line per tick forever while the job
 * still reports `succeeded`, and the stuck state is invisible.
 */
const RELAY_STUCK_AFTER_DEFAULT_MS = 24 * 60 * 60 * 1000;

/**
 * The floor matters more than the ceiling. Below an hour the escalation fires on
 * candidates a single transient outage produced, which is precisely the "an alert
 * that fires on a healthy install is worse than no alert" failure (#2615).
 */
const RELAY_STUCK_AFTER_MIN_MS = 60 * 60 * 1000;
const RELAY_STUCK_AFTER_MAX_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * **The single resolution path** for the grace window (#2229).
 *
 * One function feeds the cutoff the frontier selects on and nothing else derives a
 * second copy of it. A non-finite or non-positive value falls back to the default
 * rather than throwing — the `resolveFulfillmentDispatchTimeoutMs` /
 * `resolveSweepLockTtlMs` idiom, since a malformed env var must not wedge a sweep.
 */
export function resolveFulfillmentRelayGraceMs(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return RELAY_GRACE_DEFAULT_MS;
  }
  return Math.min(Math.max(parsed, RELAY_GRACE_MIN_MS), RELAY_GRACE_MAX_MS);
}

/**
 * **The single resolution path** for the escalation age (#2229).
 *
 * Its output feeds BOTH the per-candidate classification and the sentence logged
 * about it, so the number an operator reads is structurally the number that
 * classified the work.
 *
 * The two bounds are resolved INDEPENDENTLY and no ordering between them is
 * enforced: a deployment that sets a stuck age below its grace window makes every
 * candidate escalate on the tick it first becomes eligible, which is noisy and
 * harmless — it changes what is logged and counted, never what is re-driven or
 * written. Coupling the clamps would silently rewrite one operator-set number from
 * the other, which is the reported-versus-enforced gap #2229 exists to close.
 */
export function resolveFulfillmentRelayStuckAfterMs(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return RELAY_STUCK_AFTER_DEFAULT_MS;
  }
  return Math.min(Math.max(parsed, RELAY_STUCK_AFTER_MIN_MS), RELAY_STUCK_AFTER_MAX_MS);
}

/**
 * Has this work been shipped-but-unrelayed for long enough to escalate?
 *
 * **A statement about ELAPSED TIME, deliberately not about attempt count**, and the
 * deviation from #3013 is worth stating because that issue solves this same defect
 * one grain down, on `shipments`, and chose a count.
 *
 * Three reasons the count does not transfer. (1) **There is nowhere to put it.**
 * A count needs columns, and `FulfillmentWorkView` — the only operator-facing
 * projection of a work — deliberately EXCLUDES relay hygiene, pinned by a type
 * test; #3013's counters earned their columns because `/shipments` already existed
 * to render them. Five columns no reader consults is dead data. (2) **The age is
 * already persisted**: `fulfillment_progress_claims.claimedAt` plus
 * `dispatchRelayedAt IS NULL` is a one-line SQL predicate an operator can run
 * today, with no migration and no second source of truth. (3) #3013's
 * cadence-independence argument is real for a relay whose ONLY driver is a poll of
 * operator-set cadence; here the harm an operator acts on is *"the marketplace has
 * not known this shipped for N hours"*, which is the #1947 complaint verbatim.
 *
 * Strictly greater than, so a boundary tick classifies as not-yet-stuck — the
 * conservative direction for a signal whose whole purpose is to be believed.
 */
export function isFulfillmentRelayStuck(
  shippedAt: Date,
  now: Date,
  stuckAfterMs: number
): boolean {
  return now.getTime() - shippedAt.getTime() > stuckAfterMs;
}

/**
 * The operator-facing sentence, built from the SAME number that classified the work.
 *
 * Minutes-or-hours rather than raw milliseconds: it is read by a person deciding
 * whether the bound is set sensibly. PII-free by construction — it carries a
 * duration and nothing else.
 */
export function describeFulfillmentRelayStuck(stuckAfterMs: number): string {
  const hours = Math.round(stuckAfterMs / 3_600_000);
  if (hours < 48) {
    return `The source has not been told this work dispatched, ${String(hours)} hours after it shipped`;
  }
  const days = Math.round(stuckAfterMs / 86_400_000);
  return `The source has not been told this work dispatched, ${String(days)} days after it shipped`;
}
