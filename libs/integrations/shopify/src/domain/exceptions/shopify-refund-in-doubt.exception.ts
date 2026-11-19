/**
 * Shopify Refund In Doubt Exception
 *
 * A refund reached Shopify and its outcome cannot be stated: some of its
 * transactions failed while others did not, or `refundCreate` answered without
 * a refund and without an error. Money may have moved in part, so the operator
 * checks the order in the Shopify admin. Core records the attempt as in doubt
 * and never resends it on its own.
 *
 * @module libs/integrations/shopify/src/domain/exceptions
 */

export class ShopifyRefundInDoubtException extends Error {
  constructor(
    readonly externalOrderId: string,
    readonly connectionId: string,
    detail: string,
  ) {
    super(`Shopify refund on order ${externalOrderId} is in doubt: ${detail} (connection: ${connectionId})`);
    this.name = 'ShopifyRefundInDoubtException';
    Error.captureStackTrace(this, this.constructor);
  }
}
