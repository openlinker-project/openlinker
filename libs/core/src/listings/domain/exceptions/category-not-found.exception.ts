/**
 * Category Not Found Exception
 *
 * Neutral domain exception thrown by adapters implementing
 * `CategoryParametersReader` (or any future per-category capability) when
 * the marketplace returns a 404 for the requested categoryId. The platform
 * label is included so logs and HTTP error filters can disambiguate which
 * adapter raised it.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class CategoryNotFoundException extends Error {
  constructor(
    public readonly categoryId: string,
    public readonly platform: string,
  ) {
    super(`Category not found: ${categoryId} (platform=${platform})`);
    this.name = 'CategoryNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}
