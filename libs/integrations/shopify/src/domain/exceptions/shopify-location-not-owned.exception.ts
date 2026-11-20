/**
 * Shopify Location Not Owned Exception
 *
 * A stock write named an OpenLinker location this connection does not own (or
 * one that stands for no active Shopify location). Refused before anything is
 * sent, and a refusal of the same shape as any other `ShopifyNotSupportedException`:
 * nothing was written, and the same call is refused the same way.
 *
 * @module libs/integrations/shopify/src/domain/exceptions
 */
import { ShopifyNotSupportedException } from './shopify-not-supported.exception';

export class ShopifyLocationNotOwnedException extends ShopifyNotSupportedException {
  constructor(
    readonly olLocationId: string,
    readonly connectionId: string,
    reason: string,
  ) {
    super(`adjust stock at location ${olLocationId}`);
    this.message = `Cannot adjust stock at OpenLinker location ${olLocationId} through Shopify connection ${connectionId}: ${reason}`;
    this.name = 'ShopifyLocationNotOwnedException';
  }
}
