/**
 * Shopify Config Exception
 *
 * The connection's config or stored credentials cannot be used. Fixed by the
 * operator, never by a retry.
 *
 * @module libs/integrations/shopify/src/domain/exceptions
 */

export class ShopifyConfigException extends Error {
  constructor(
    readonly connectionId: string,
    detail: string,
    /** The config key at fault, when one is (`locationId`, ...), so a surface can name it. */
    readonly field?: string,
  ) {
    super(`Shopify connection ${connectionId} is misconfigured: ${detail}`);
    this.name = 'ShopifyConfigException';
    Error.captureStackTrace(this, this.constructor);
  }
}
