/**
 * Shopify Order Too Large Exception
 *
 * An order carries more of a nested list (lines, shipping lines) than one
 * ingestion will page through. Ingesting a PARTIAL order would under-bill the
 * buyer's real order and mis-state its totals with nothing flagging it, so the
 * read refuses instead. Deterministic: a retry sees the same order.
 *
 * @module libs/integrations/shopify/src/domain/exceptions
 */

export class ShopifyOrderTooLargeException extends Error {
  constructor(
    readonly externalOrderId: string,
    readonly what: string,
    readonly connectionId: string,
  ) {
    super(
      `Shopify order ${externalOrderId} has more ${what} than can be ingested whole; ` +
        `it is refused rather than ingested partially (connection: ${connectionId})`,
    );
    this.name = 'ShopifyOrderTooLargeException';
    Error.captureStackTrace(this, this.constructor);
  }
}
