/**
 * Invalid Numbering Pattern Exception
 *
 * Domain error carrying the flat list of validation issues a numbering-series
 * pattern failed on (#1575) — a missing `{seq}`, or a reset policy not covered by
 * the pattern's date variables. Thrown by `assertValidNumberingPattern`; the C2
 * HTTP layer maps it to a 400 with the issue list. Neutral vocabulary only.
 *
 * @module libs/core/src/invoicing/domain/exceptions
 */
export class InvalidNumberingPatternException extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid numbering pattern: ${issues.join(' ')}`);
    this.name = 'InvalidNumberingPatternException';
    Error.captureStackTrace(this, this.constructor);
  }
}
