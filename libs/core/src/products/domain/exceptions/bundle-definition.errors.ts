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

/**
 * Two writers raced on one variant's next version (the unique
 * `(variantId, version)` index refused the loser). A subclass of
 * {@link BundleDefinitionAlreadyExistsError} so the HTTP layer answers the same
 * 409; the message tells the caller to re-read and retry.
 */
export class BundleDefinitionConcurrentWriteError extends BundleDefinitionAlreadyExistsError {
  constructor(variantId: string) {
    super(variantId);
    this.message = `Variant ${variantId} was changed by another request at the same time; reload and try again`;
    this.name = 'BundleDefinitionConcurrentWriteError';
  }
}

export const BundleMasterSyncRefusalReasonValues = [
  'no-master',
  'master-cannot-read-bundles',
  'not-a-bundle-in-master',
  'component-unmapped',
  /** The master connection exists but could not be reached (credentials, transport). */
  'master-unavailable',
] as const;
export type BundleMasterSyncRefusalReason = (typeof BundleMasterSyncRefusalReasonValues)[number];

/**
 * "Sync composition from the master" was refused (#3932). Named per reason so
 * the operator surface says which one, and `unmappedComponents` names every
 * component OpenLinker has no variant for.
 */
export class BundleMasterSyncRefusedError extends Error {
  readonly code = 'BUNDLE_MASTER_SYNC_REFUSED';

  constructor(
    readonly reason: BundleMasterSyncRefusalReason,
    message: string,
    readonly unmappedComponents: string[] = []
  ) {
    super(message);
    this.name = 'BundleMasterSyncRefusedError';
    Error.captureStackTrace(this, this.constructor);
  }
}
