/**
 * Fulfilment Dispatch Enqueue Intents (#2955, `W3a-16`, ADR-053, ADR-054)
 *
 * The pure half of the FIRST producer of `fulfillment.work.dispatch`. Given the
 * work a routing commit just created, it decides which rows may be offered to a
 * holder and under what enqueue dedupe key; the hosts perform the I/O.
 *
 * ## Why this is a derivation and not an enqueue
 *
 * `fulfillment` is a registered zero-sibling-edge leaf, so it may not import
 * `@openlinker/core/sync` — the report-don't-perform discipline ADR-053 states,
 * and the same shape `IFulfillmentProgressService.record` already takes when it
 * reports a `FulfillmentRelayIntent` instead of firing one.
 *
 * It is ALSO why the intent is neutral rather than an `EnqueueJobRequest`: the
 * two hosts reach different ports with incompatible request shapes —
 * `OrderIngestionService` has `SyncJobQueuePort` (`{type, connectionId, payload,
 * options: {dedupeKey}}`) and `FulfillmentWorkRouteHandler` has `JobEnqueuePort`
 * (`{jobType, connectionId, payload, idempotencyKey}`). One decision body, two
 * four-line mappings.
 *
 * ## The name
 *
 * `FulfillmentDispatchEnqueueIntent`, never `FulfillmentDispatchIntent` — that
 * one is #2401's RELAY intent (`@openlinker/core/orders`), meaning "tell the
 * order's participants it shipped". `OrderIngestionService` consumes both, and
 * two same-named types describing opposite directions in one file is the drift
 * this programme keeps paying for.
 *
 * @module libs/core/src/fulfillment/domain/types
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 * @see docs/architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md
 */

/**
 * One work row a routing commit created, with the holder the router assigned.
 *
 * `assignedConnectionId` is nullable because `FulfillmentWorkRepositoryPort.create`
 * permits it; {@link deriveFulfillmentDispatchEnqueueIntents} is what refuses to
 * dispatch such a row.
 *
 * It deliberately does NOT carry `assignmentAttempt` — see
 * {@link FulfillmentDispatchEnqueueIntent} for why the payload's
 * `expectedAssignmentAttempt` must be `null`, which makes an attempt here a
 * field whose only correct use is not to use it.
 */
export interface RoutedWorkRef {
  readonly workId: string;
  readonly assignedConnectionId: string | null;
}

/**
 * "Ask this holder to fulfil this work."
 *
 * `connectionId` is the work's own `assignedConnectionId` and becomes
 * `SyncJob.connectionId` — never a synthetic id, because #2609's defect was
 * precisely a shared scope collapsing ADR-050's per-(lane, scope) accounting
 * installation-wide.
 *
 * There is no `expectedAssignmentAttempt` on the intent because it is always
 * `null`, and that is REQUIRED rather than merely acceptable:
 * `claimDispatchAttempt` bumps the counter itself, so any pre-claim value a
 * first-dispatch producer could pass is stale the moment the first run succeeds
 * — on a retry `claimOrResume` sees the claim refused, `requestStatus` already
 * `submitted`, and `current.assignmentAttempt !== expectedAttempt`, and declines
 * to resume. Passing `0` would make this producer's own retry send nothing.
 */
export interface FulfillmentDispatchEnqueueIntent {
  readonly workId: string;
  readonly connectionId: string;
  readonly orderId: string;
  readonly dedupeKey: string;
}

/**
 * The enqueue dedupe key for one work row.
 *
 * Its own namespace, deliberately NOT `work:{workId}:{assignmentAttempt}` —
 * that is the HANDSHAKE's key, which #2399 made obtainable only through
 * `claimDispatchAttempt`'s `RETURNING` precisely so it cannot exist without the
 * row already holding that value. Re-deriving it here would reintroduce the
 * shape that guarantee removes. This key answers a different question: *have we
 * already asked a worker to run this dispatch?*
 *
 * **Constraint recorded against #2395.** `sync_jobs.idempotencyKey` is globally
 * unique with NO TTL, so a SECOND dispatch job for the same work row is silently
 * swallowed — the enqueue reports an existing job, no row is created, and
 * nothing errors. `CLAIMABLE_FROM = ['unsubmitted', 'rejected']`, so a work its
 * holder REJECTED is re-claimable on the same row, which is exactly what a
 * router-driven re-request does. Nothing in the tree bumps `assignmentAttempt`
 * today, so this is unreachable; the day a re-request or a re-source path lands,
 * this key MUST gain a generation component (the routing `decisionId`, or the
 * attempt) or that re-dispatch is lost with no signal. A re-ROUTE that mints new
 * work rows is already safe — new ids, new keys.
 */
export function buildFulfillmentDispatchDedupeKey(workId: string): string {
  return `fulfillment:dispatch:${workId}`;
}

/**
 * Which of a routing commit's work rows may be offered to a holder.
 *
 * Work carrying no holder is SKIPPED rather than enqueued: `SyncJob.connectionId`
 * is non-nullable, and `FulfillmentHandshakeService.dispatch` throws the
 * RETRYABLE `FulfillmentWorkUnassignedError` for unassigned work — so enqueueing
 * one can only burn the full retry ladder and leave a dead row. The caller warns
 * with the ids, because a skipped dispatch is the difference between a bench
 * that fills and one that stays empty, and that must never be inferred from an
 * absence.
 *
 * Pure: no I/O, no clock, no mutation of its arguments.
 */
export function deriveFulfillmentDispatchEnqueueIntents(
  works: readonly RoutedWorkRef[],
  orderId: string
): readonly FulfillmentDispatchEnqueueIntent[] {
  const intents: FulfillmentDispatchEnqueueIntent[] = [];

  for (const work of works) {
    if (work.assignedConnectionId === null) continue;
    intents.push({
      workId: work.workId,
      connectionId: work.assignedConnectionId,
      orderId,
      dedupeKey: buildFulfillmentDispatchDedupeKey(work.workId),
    });
  }

  return intents;
}

/** The work ids {@link deriveFulfillmentDispatchEnqueueIntents} refused, for the caller's warning. */
export function findUndispatchableWorkIds(works: readonly RoutedWorkRef[]): readonly string[] {
  return works.filter((work) => work.assignedConnectionId === null).map((work) => work.workId);
}
