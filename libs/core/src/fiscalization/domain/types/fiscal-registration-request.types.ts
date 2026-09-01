/**
 * Fiscal Registration Request Types (#2525)
 *
 * The vocabulary of ASKING for a registration, as distinct from performing one.
 *
 * A manual registration used to be performed inline inside the HTTP request that
 * asked for it, so "asked" and "registered" were the same event and needed no
 * separate words. They are now separate acts: the request records an intention
 * and returns, and the sale is registered later by the `fiscalization.register`
 * job. Nothing here reports an outcome, and there is deliberately nothing in it
 * a caller could read as one.
 *
 * @module libs/core/src/fiscalization/domain/types
 */

/**
 * The exactly-once key one connection registering one order is held under.
 *
 * ONE definition, three callers - the HTTP surface, the auto-issue gate, and the
 * service that enqueues on their behalf. It was previously written out at two
 * call sites that had to agree by inspection; they now agree by construction,
 * which is what keeps a manual request and an automatic one from becoming two
 * registrations of one sale.
 *
 * It is derived from `(connectionId, orderId)` and is never caller-supplied: a
 * caller-chosen key misses the `(connectionId, idempotencyKey)` read gate and
 * registers the same sale again. See `RegisterFiscalTransactionRequestDto` for
 * the full reasoning.
 */
export function fiscalRegistrationIdempotencyKey(
  connectionId: string,
  orderId: string,
): string {
  return `fiscal:${connectionId}:${orderId}`;
}

/**
 * What a caller learns from asking for a registration.
 *
 * It says the request was ACCEPTED and names the row that will carry the answer.
 * It carries no status, no outcome and no estimate of when the answer arrives,
 * because at this point none of the three exists: the job has been written and
 * nothing has been sent to any provider.
 *
 * `jobId` identifies the enqueued `fiscalization.register` job, which may be one
 * a previous request already created - two requests for the same
 * `(connection, order)` produce one job, and the second returns the first one's
 * id rather than a second job or an error.
 */
export interface FiscalRegistrationRequestAccepted {
  orderId: string;
  connectionId: string;
  /** The exactly-once key the job and the eventual record both carry. */
  idempotencyKey: string;
  /** The enqueued (or already-enqueued) `fiscalization.register` job. */
  jobId: string;
  /**
   * True when this request re-drove a job that had exhausted its retries and was
   * left `dead`, rather than enqueueing or joining a live one.
   *
   * Reported because it is the difference between "your request is waiting its
   * turn" and "a previous attempt had given up and has been restarted", which an
   * operator repeating an action is entitled to know. It says nothing about
   * whether the sale is registered.
   */
  redrivenFromDead: boolean;
}
