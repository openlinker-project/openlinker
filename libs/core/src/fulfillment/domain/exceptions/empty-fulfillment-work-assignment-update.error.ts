/**
 * Empty Fulfillment Work Assignment Update Error (#3337, ADR-074)
 *
 * `UpdateFulfillmentWorkAssignmentInput`'s two fields are both optional so a
 * caller can move one axis without restating the other — but a request that
 * moves NEITHER is not a legal no-op, it is a caller mistake (a body that
 * serialized to `{}`, or an empty PATCH sent by accident). Silently answering
 * 200 for it would hide exactly that mistake.
 *
 * @module libs/core/src/fulfillment/domain/exceptions
 */
export class EmptyFulfillmentWorkAssignmentUpdateError extends Error {
  constructor(public readonly workId: string) {
    super(
      `Assignment update for ${workId} named neither 'assignedToUserId' nor ` +
        `'selfServeEligible' — nothing to apply`
    );
    this.name = 'EmptyFulfillmentWorkAssignmentUpdateError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, EmptyFulfillmentWorkAssignmentUpdateError);
    }
  }
}
