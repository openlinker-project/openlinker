/**
 * Fulfillment Work Version Mismatch Error (#2406, `W3a-19`)
 *
 * The PERSISTENCE-level fact: the row's `version` is not the one the caller
 * expected. Raised only from the hold write paths, which return a `FulfillmentHold`
 * and so have no `false` with which to report a refused precondition.
 *
 * ## Why this is not `FulfillmentWorkVersionConflictError`
 *
 * That one carries `supportedActions`, which is a DERIVATION — an application
 * concern. A repository constructing it would have to import the derivation and
 * decide what the operator may do next, which is not a persistence
 * responsibility. So the repository reports the bare fact and the worklist
 * service enriches it. Same split as everywhere else here: the repository
 * answers what the row did, the service answers what it means.
 *
 * @module libs/core/src/fulfillment/domain/exceptions
 */
export class FulfillmentWorkVersionMismatchError extends Error {
  constructor(
    public readonly workId: string,
    public readonly expectedVersion: number,
    public readonly currentVersion: number
  ) {
    super(
      `Fulfillment work ${workId} is at version ${String(currentVersion)}, ` +
        `not the expected ${String(expectedVersion)}`
    );
    this.name = 'FulfillmentWorkVersionMismatchError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FulfillmentWorkVersionMismatchError);
    }
  }
}
