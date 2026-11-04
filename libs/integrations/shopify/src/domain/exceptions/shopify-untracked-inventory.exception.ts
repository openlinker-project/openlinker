/**
 * Shopify Untracked Inventory Exception
 *
 * Every variant of the product has stock tracking switched off, which on
 * Shopify means "always available" - there is no number to report. Reporting
 * 0 would zero live offers, and inventing a large number would oversell, so
 * the sync refuses instead.
 *
 * @module libs/integrations/shopify/src/domain/exceptions
 */

export class ShopifyUntrackedInventoryException extends Error {
  constructor(
    readonly productId: string,
    readonly connectionId: string,
  ) {
    super(
      `Shopify product ${productId} tracks no stock on any variant; nothing to sync ` +
        `(connection: ${connectionId})`,
    );
    this.name = 'ShopifyUntrackedInventoryException';
    Error.captureStackTrace(this, this.constructor);
  }
}
