/**
 * Catalog Product Not Found Exception
 *
 * Thrown by `CatalogProductReader.getProduct` when the marketplace catalog
 * returns 404 for the given product id. The HTTP controller maps this to a
 * 404 Not Found response.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class CatalogProductNotFoundException extends Error {
  constructor(productId: string) {
    super(`Catalog product not found: ${productId}`);
    this.name = 'CatalogProductNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}
