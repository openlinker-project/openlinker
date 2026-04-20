/**
 * Offer Builder Validation Exception
 *
 * Domain exception raised by OfferBuilderService when one or more required
 * fields for creating an offer cannot be resolved from the variant, master
 * product, or caller-provided overrides. Carries a list of field-level issues
 * so callers can surface all problems at once instead of iterating.
 *
 * @module libs/core/src/listings/domain/exceptions
 */

export interface OfferBuilderValidationIssue {
  /** Dotted path of the field the issue applies to (e.g. `overrides.categoryId`). */
  field: string;
  /** Machine-readable code (e.g. `NOT_FOUND`, `REQUIRED`). */
  code: string;
  /** Human-readable message suitable for operator display. */
  message: string;
}

export class OfferBuilderValidationException extends Error {
  constructor(public readonly issues: OfferBuilderValidationIssue[]) {
    super(
      `Offer builder validation failed (${issues.length} issue${
        issues.length === 1 ? '' : 's'
      }): ${issues.map((i) => `${i.field}:${i.code}`).join(', ')}`,
    );
    this.name = 'OfferBuilderValidationException';
    Error.captureStackTrace(this, this.constructor);
  }
}
