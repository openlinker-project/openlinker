/**
 * Unsupported Fulfillment Work Action Error (#2406, `W3a-19`)
 *
 * The caller named something that is not an operator-invocable action — either
 * not an action at all, or one of the members this surface deliberately does
 * not execute (`submit` / `request_cancellation`, which need a resolved
 * `FulfillmentExecutorPort`, and the four holder replies, which are an
 * executor's answers rather than an operator's act).
 *
 * The message names the invocable set, because a client that guessed wrong
 * cannot otherwise tell a typo from a capability it does not have.
 *
 * @module libs/core/src/fulfillment/domain/exceptions
 */
export class UnsupportedFulfillmentWorkActionError extends Error {
  constructor(
    public readonly action: string,
    public readonly invocableActions: readonly string[]
  ) {
    super(
      `'${action}' is not an operator-invocable fulfillment work action; ` +
        `invocable: ${invocableActions.join(', ')}`
    );
    this.name = 'UnsupportedFulfillmentWorkActionError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UnsupportedFulfillmentWorkActionError);
    }
  }
}
