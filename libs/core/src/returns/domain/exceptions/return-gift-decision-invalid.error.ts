/**
 * Return Gift Decision Invalid Error (#3943)
 *
 * The decision cannot be recorded as asked: a `deduct` with no positive amount,
 * an amount sent with a decision that takes nothing off the refund, or a line that is
 * not a gift on the return's order. A request
 * problem (400), never a state one.
 *
 * @module domain/exceptions
 */
export type ReturnGiftDecisionInvalidReason =
  | 'deduction-required'
  | 'deduction-not-allowed'
  | 'unknown-gift-line';

export class ReturnGiftDecisionInvalidError extends Error {
  constructor(public readonly reason: ReturnGiftDecisionInvalidReason) {
    super(
      reason === 'deduction-required'
        ? 'Deducting a gift needs the amount to take off the refund.'
        : reason === 'deduction-not-allowed'
          ? 'Only a deduction carries an amount.'
          : 'The line is not a gift on the order of this return.'
    );
    this.name = 'ReturnGiftDecisionInvalidError';
    Error.captureStackTrace(this, this.constructor);
  }
}
