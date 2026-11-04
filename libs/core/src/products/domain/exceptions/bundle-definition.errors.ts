/**
 * Bundle definition errors (#3607)
 *
 * Named so the HTTP layer can answer a stable machine-readable `code` and an
 * operator can tell a refused nesting from a missing variant.
 *
 * @module libs/core/src/products/domain/exceptions
 */
export const BundleNestingReasonValues = [
  'component-is-bundle',
  'variant-is-component',
  'component-is-self',
] as const;
export type BundleNestingReason = (typeof BundleNestingReasonValues)[number];

/** A bundle cannot contain a bundle, and a component variant cannot become one. */
export class BundleNestingError extends Error {
  readonly code = 'BUNDLE_NESTING_REFUSED';

  constructor(
    readonly reason: BundleNestingReason,
    readonly variantId: string,
    readonly otherVariantId: string
  ) {
    super(
      reason === 'component-is-bundle'
        ? `Variant ${otherVariantId} is itself a bundle and cannot be a component of ${variantId}`
        : reason === 'variant-is-component'
          ? `Variant ${variantId} is a component of bundle ${otherVariantId} and cannot become a bundle`
          : `Variant ${variantId} cannot be a component of itself`
    );
    this.name = 'BundleNestingError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BundleDefinitionNotFoundError extends Error {
  readonly code = 'BUNDLE_DEFINITION_NOT_FOUND';

  constructor(readonly variantId: string) {
    super(`No bundle definition for variant ${variantId}`);
    this.name = 'BundleDefinitionNotFoundError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BundleDefinitionInvalidError extends Error {
  readonly code = 'BUNDLE_DEFINITION_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'BundleDefinitionInvalidError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BundleDefinitionAlreadyExistsError extends Error {
  readonly code = 'BUNDLE_DEFINITION_ALREADY_EXISTS';

  constructor(readonly variantId: string) {
    super(`Variant ${variantId} already has a bundle definition; update it instead`);
    this.name = 'BundleDefinitionAlreadyExistsError';
    Error.captureStackTrace(this, this.constructor);
  }
}
