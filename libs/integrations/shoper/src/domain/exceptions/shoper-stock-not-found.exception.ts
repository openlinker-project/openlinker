/**
 * ShoperStockNotFoundException
 *
 * Thrown when a product resolved at the shop but carries no `product-stocks`
 * row, so there is no stock level to report. Deliberately NOT the neutral
 * `MasterProductNotFoundError`: that error means the shop said the product is
 * gone, whereas this is an INFERRED absence (the product answers, it simply has
 * no stock entry), and an inferred absence must never stale a catalogue (#1688).
 * Left platform-native, it is retried.
 *
 * @module libs/integrations/shoper/src/domain/exceptions
 */
export class ShoperStockNotFoundException extends Error {
  constructor(
    readonly productId: string,
    readonly connectionId: string,
  ) {
    super(`No stock row found for product ${productId} on connection ${connectionId}`);
    this.name = 'ShoperStockNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}
