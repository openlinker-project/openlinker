/**
 * Fulfillment Work Version Conflict Error (#2406, `W3a-19`, REVIEW C10)
 *
 * The optimistic token an operator acted with no longer matches the work's
 * `version`: somebody else moved it first. Mapped to **409 carrying the
 * refreshed action set** — never a silent overwrite, because the failure this
 * guards is two operators shipping the same work twice.
 *
 * ## It carries scalars, not the view
 *
 * `supportedActions` + `currentVersion` rather than a `FulfillmentWorkView`,
 * which lives in the application layer — a domain exception importing it would
 * invert the layer dependency. These two are exactly what a client needs to
 * re-render its controls and retry, and both are domain vocabulary.
 *
 * ## The refreshed values are a best-effort SNAPSHOT, not a guarantee
 *
 * They come from a re-read on the conflict path, which can itself be stale by
 * the time it returns. That is safe and deliberate: the client's retry is
 * guarded by the same token, so a stale refresh costs one additional 409 and
 * can never produce a wrong write.
 *
 * @module libs/core/src/fulfillment/domain/exceptions
 */
import type { FulfillmentWorkAction } from '../types/fulfillment-work-action.types';

export class FulfillmentWorkVersionConflictError extends Error {
  constructor(
    public readonly workId: string,
    public readonly expectedVersion: number,
    public readonly currentVersion: number,
    public readonly supportedActions: readonly FulfillmentWorkAction[]
  ) {
    super(
      `Fulfillment work ${workId} was modified by someone else ` +
        `(acted with version ${String(expectedVersion)}, current is ${String(currentVersion)})`
    );
    this.name = 'FulfillmentWorkVersionConflictError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FulfillmentWorkVersionConflictError);
    }
  }
}
