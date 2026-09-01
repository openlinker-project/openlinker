/**
 * Fulfillment Work Action Not Legal Error (#2406, `W3a-19`)
 *
 * The token MATCHED — nobody else moved the work — but the action is not legal
 * on the state it is in.
 *
 * ## Why this is a separate error from a version conflict, and load-bearing
 *
 * `fulfillment-work.types.ts` states of `version`: *"Counts state changes, not
 * writes … a caller replaying an already-applied action sees 'not applied'
 * against an UNCHANGED version, **which must not be reported as a stale-token
 * 409**."*
 *
 * Threading `expectedVersion` into the same conditional UPDATE as the state
 * predicate is what makes the two distinguishable at all: a write that matched
 * the version but not the state leaves `version` untouched, so the service can
 * tell "somebody beat you" from "this was never legal / you already did it" and
 * report each honestly. A standalone claim-then-act could not — it bumps
 * unconditionally, collapsing both into a false stale-token answer.
 *
 * @module libs/core/src/fulfillment/domain/exceptions
 */
import type { FulfillmentWorkAction } from '../types/fulfillment-work-action.types';

export class FulfillmentWorkActionNotLegalError extends Error {
  constructor(
    public readonly workId: string,
    public readonly action: FulfillmentWorkAction,
    public readonly supportedActions: readonly FulfillmentWorkAction[]
  ) {
    super(
      `Action '${action}' is not legal on fulfillment work ${workId}; ` +
        `legal now: ${supportedActions.length > 0 ? supportedActions.join(', ') : '<none>'}`
    );
    this.name = 'FulfillmentWorkActionNotLegalError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FulfillmentWorkActionNotLegalError);
    }
  }
}
