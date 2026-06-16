/**
 * Product Publish Builder Validation Exception
 *
 * Domain exception raised by `ProductPublishBuilderService` when one or more
 * required fields for publishing a product to a shop cannot be resolved from
 * the variant, master product, caller overrides, or attribute projection
 * (e.g. an unresolved required destination parameter). Carries a list of
 * field-level issues so callers surface all problems at once.
 *
 * The shop-side neutral sibling of `OfferBuilderValidationException` — kept
 * distinct so the shop builder does not import an offer-named symbol. The
 * execution service maps it to a `failed` record + `business_failure` outcome.
 *
 * @module libs/core/src/listings/domain/exceptions
 */

export interface ProductPublishBuilderValidationIssue {
  /** Dotted path of the field the issue applies to (e.g. `parameters.Brand`). */
  field: string;
  /** Machine-readable code (e.g. `NOT_FOUND`, `REQUIRED`). */
  code: string;
  /** Human-readable message suitable for operator display. */
  message: string;
}

export class ProductPublishBuilderValidationException extends Error {
  constructor(public readonly issues: ProductPublishBuilderValidationIssue[]) {
    super(
      `Product publish builder validation failed (${issues.length} issue${
        issues.length === 1 ? '' : 's'
      }): ${issues.map((i) => `${i.field}:${i.code}`).join(', ')}`
    );
    this.name = 'ProductPublishBuilderValidationException';
    Error.captureStackTrace(this, this.constructor);
  }
}
