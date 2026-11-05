/**
 * Return Gift Decision Invalid Error (#3943)
 *
 * The decision cannot be recorded as asked: a `deduct` with no positive amount,
 * or an amount sent with a decision that takes nothing off the refund. A request
 * problem (400), never a state one.
 *
 * @module domain/exceptions
 */
export type ReturnGiftDecisionInvalidReason = 'deduction-required' | 'deduction-not-allowed';

export class ReturnGiftDecisionInvalidError extends Error {
  constructor(public readonly reason: ReturnGiftDecisionInvalidReason) {
    super(
      reason === 'deduction-required'
        ? 'Deducting a gift needs the amount to take off the refund.'
        : 'Only a deduction carries an amount.'
    );
    this.name = 'ReturnGiftDecisionInvalidError';
    Error.captureStackTrace(this, this.constructor);
  }
}
