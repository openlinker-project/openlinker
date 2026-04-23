/**
 * No Linked Offers Exception
 *
 * Thrown by the channel publisher when the target product has no offers
 * mapped to any of its variants on the requested connection. The operation
 * is a precondition failure (the product exists, the connection exists,
 * only the mapping is missing) — surfaced as HTTP 422.
 *
 * @module libs/core/src/content/domain/exceptions
 */
export class NoLinkedOffersException extends Error {
  public readonly productId: string;
  public readonly connectionId: string;

  constructor(productId: string, connectionId: string) {
    super(
      `No offers are linked to product ${productId} on connection ${connectionId}. Sync or link offers before publishing a channel override.`,
    );
    this.name = 'NoLinkedOffersException';
    this.productId = productId;
    this.connectionId = connectionId;
    Error.captureStackTrace(this, this.constructor);
  }
}
