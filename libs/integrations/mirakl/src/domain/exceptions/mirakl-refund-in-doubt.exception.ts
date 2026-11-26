/**
 * Mirakl Refund In Doubt Exception
 *
 * A refund whose outcome is unknown: an earlier attempt with the same key did
 * not finish, so the money may already have moved. Thrown rather than answered
 * as `denied`, because core reads a throw as "boundary crossed, outcome
 * unobserved" and blocks further attempts, while `denied` would allow a second
 * refund.
 *
 * @module libs/integrations/mirakl/src/domain/exceptions
 */
export class MiraklRefundInDoubtException extends Error {
  constructor(
    public readonly externalOrderId: string,
    public readonly connectionId: string,
    detail: string
  ) {
    super(`Refund of order ${externalOrderId} is in doubt: ${detail}`);
    this.name = 'MiraklRefundInDoubtException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MiraklRefundInDoubtException);
    }
  }
}
