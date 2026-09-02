/**
 * Fulfillment Work Unassigned Error (#2399, `W3a-10`)
 *
 * A dispatch was asked for work carrying no `assignedConnectionId`.
 *
 * **Deliberately RETRYABLE, and that is the whole point of it existing.** The
 * obvious alternative — reporting it as ADR-007 `business_failure` — is terminal,
 * and this slice does not own the enqueue. If #2395's router enqueues the
 * dispatch before `assignHolder` commits, or from a different transaction, a
 * terminal answer would dead-end permanently on work that becomes assignable a
 * moment later. Throwing lets the retry ladder absorb that race.
 *
 * @module libs/core/src/fulfillment/domain/exceptions
 */
export class FulfillmentWorkUnassignedError extends Error {
  constructor(public readonly workId: string) {
    super(`Fulfillment work ${workId} has no assigned holder to dispatch to`);
    this.name = 'FulfillmentWorkUnassignedError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FulfillmentWorkUnassignedError);
    }
  }
}
