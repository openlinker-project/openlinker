/**
 * WooCommerce Invalid Argument Exception
 *
 * Thrown when a caller supplies an argument that fails local validation
 * before any HTTP call is made. Examples: a non-numeric `externalOrderId`
 * supplied to `updateFulfillment`, an empty required string.
 *
 * Distinct from `WooCommerceResourceNotFoundException` (which is reserved for
 * "entity exists in OL but is absent on the WC side") and from
 * `WooCommerceOrderProcessingException` (which signals a domain-logic failure).
 *
 * @module libs/integrations/woocommerce/src/domain/exceptions
 */
export class WooCommerceInvalidArgumentException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WooCommerceInvalidArgumentException';
    Error.captureStackTrace(this, this.constructor);
  }
}
