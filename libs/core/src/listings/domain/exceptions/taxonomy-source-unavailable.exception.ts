/**
 * Taxonomy Source Unavailable Exception (#1979, ADR-037)
 *
 * Thrown when a connection cannot be resolved to a taxonomy scope — it neither
 * browses a marketplace taxonomy (`CategoryBrowser`), nor borrows one
 * (`TaxonomyBorrower`), nor browses its own shop taxonomy
 * (`ShopCategoryBrowser`).
 *
 * Deliberately a DOMAIN exception rather than the NestJS
 * `UnprocessableEntityException` that the sibling `ShopCategoryBrowseService`
 * throws from core — that is a pre-existing layering violation, not a pattern
 * to copy, so do not "harmonise" this back. The interface layer maps it to 422.
 *
 * @module libs/core/src/listings/domain/exceptions
 */

export class TaxonomySourceUnavailableException extends Error {
  constructor(
    public readonly connectionId: string,
    public readonly reason: string,
  ) {
    super(`No taxonomy source for connection ${connectionId}: ${reason}`);
    this.name = 'TaxonomySourceUnavailableException';
    Error.captureStackTrace(this, this.constructor);
  }
}
