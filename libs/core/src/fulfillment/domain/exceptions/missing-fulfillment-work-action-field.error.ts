/**
 * Missing Fulfillment Work Action Field Error (#2406, `W3a-19`)
 *
 * The action IS one this surface executes; the caller just did not send a field
 * that action requires — `hold` without a reason, `release_hold` without a hold
 * id.
 *
 * ## Why this is not `UnsupportedFulfillmentWorkActionError`
 *
 * That error means "this action name is not invocable", and its message names
 * the invocable set so a client can correct a typo. Reusing it here produced
 * copy that contradicted itself:
 *
 *     'hold (without a reason)' is not an operator-invocable fulfillment work
 *     action; invocable: schedule, hold, release_hold, …
 *
 * — denying that `hold` is invocable in the same breath as listing it. A client
 * reading that would look for a capability problem it does not have, when the
 * real fix is one missing field. Two different facts, two errors; both are 400,
 * because both are a malformed request rather than a state conflict.
 *
 * The action and the field are carried separately so a caller can act on them
 * without parsing the message.
 *
 * @module libs/core/src/fulfillment/domain/exceptions
 */
export class MissingFulfillmentWorkActionFieldError extends Error {
  constructor(
    public readonly action: string,
    public readonly field: string
  ) {
    super(`The '${action}' action requires '${field}', which was not supplied`);
    this.name = 'MissingFulfillmentWorkActionFieldError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MissingFulfillmentWorkActionFieldError);
    }
  }
}
