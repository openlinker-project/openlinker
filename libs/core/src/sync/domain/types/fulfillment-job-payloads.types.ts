/**
 * Fulfilment Job Payload Types (#2399, `W3a-10`, ADR-054)
 *
 * Canonical payload schema for `fulfillment.work.dispatch`.
 *
 * @module libs/core/src/sync/domain/types
 */

/**
 * Offer one routed `FulfillmentWork` to its assigned holder.
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
