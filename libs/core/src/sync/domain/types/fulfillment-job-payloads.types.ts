/**
 * Fulfillment Job Payload Types (#2399 / #2400, ADR-054)
 *
 * Canonical payload schemas for the two fulfilment job types: outbound
 * `fulfillment.work.dispatch` (#2399 — offer the work to its holder) and
 * inbound `fulfillment.work.statusSync` (#2400 — the job a `fulfillment`-domain
 * webhook routes to). They are opposite directions of the same negotiation and
 * share nothing but this file.
 *
 * ## The payload carries a REFERENCE, never the progress itself
 *
 * There are deliberately no line deltas, no quantities and no status here, and
 * that absence is the contract rather than an omission to be filled in later.
 * `CanonicalInboundEvent.payload` — the only thing an inbound webhook can
 * supply — is documented as a *"Non-authoritative payload hint; never source of
 * truth"*, so moving `fulfillment_work_lines` counters off it would write
 * fulfilment state from an unauthenticated body. That is precisely what the
 * shipped webhook-as-trigger discipline (#904) exists to prevent, and why the
 * `master.*` arms carry an `externalId` and nothing else either.
 *
 * The authoritative read that fills the gap is `FulfillmentStatusSource`
 * (#2398), which does not exist in the tree yet. Until it does this job
 * resolves its reference, logs, and completes — see the handler. Widening THIS
 * type to carry deltas is the one change that must not be made to make the
 * handler "work"; add the pull instead.
 *
 * @module libs/core/src/sync/domain/types
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 */

/**
 * Payload for `fulfillment.work.statusSync` (`realtime` lane).
 *
 * Connection id comes from `job.connectionId`, not the payload — the same rule
 * every other inbound-routed payload in this directory follows.
 */
export interface FulfillmentWorkStatusSyncPayloadV1 {
  schemaVersion: 1;
  /**
   * The executor's own reference for the work object.
   *
   * **Nothing resolves this to an OL `workId` yet.** #2399 owns the executor
   * handshake and therefore owns the writer, and with it the choice between a
   * `fulfillment_works.externalWorkId` column (the `returns.externalReturnId`
   * shape) and `identifier_mappings` resolution. #2400 deliberately declines to
   * guess: a migration is the hardest artefact to unship, and guessing would
   * hand #2399 a schema it must migrate away from.
   */
  externalWorkId: string;
  /** The delivery's stable dedupe key, carried for traceability. */
  sourceEventId: string;
  /** Advisory source-vocabulary event type. Never trusted as state. */
  eventType: string;
  /** When the source reports the event occurred (ISO 8601, advisory). */
  occurredAt?: string;
}

/**
 * Offer one routed `FulfillmentWork` to its assigned holder (#2399).
 *
 * `expectedAssignmentAttempt` is what makes a RESUME safe, and it is the whole
 * reason this payload is not just a work id. On a retry the handshake resumes an
 * already-claimed attempt so the idempotency key is re-minted IDENTICALLY; but a
 * delayed duplicate job for attempt 1, waking after a router-driven re-request
 * bumped the work to attempt 2, must NOT resume — it would mint a key it never
 * claimed, for a holder it was not enqueued against. Carrying the attempt the
 * job was enqueued for is what lets the handshake tell those two cases apart.
 *
 * `null` means "the first dispatch, claim a fresh attempt", and is also what a
 * job queued across the deploy carries — such a job resumes unconditionally,
 * exactly as it would have before this field existed.
 */
export interface FulfillmentWorkDispatchPayloadV1 {
  readonly workId: string;
  /**
   * Used ONLY to load the order for its ship-to projection — never the authority
   * on which order the work belongs to.
   *
   * The request the executor receives carries `work.orderId`, read from the row
   * inside the handshake service, so a stale payload value cannot mislabel a
   * dispatch. Carried on the payload rather than re-read from the work row
   * because the handler must resolve the ship-to BEFORE calling into core, and
   * the work row is core's to load.
   */
  readonly orderId: string;
  readonly expectedAssignmentAttempt: number | null;
}
