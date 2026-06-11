/**
 * WooCommerce Duplicate SKU Exception
 *
 * Thrown by WooCommerceProductMasterAdapter when WooCommerce rejects a
 * create/update because the SKU is already in use (WC error code
 * `product_invalid_sku`, HTTP 400). Surfacing this as a typed domain
 * exception lets callers distinguish a recoverable SKU conflict from a
 * generic transport failure.
 *
 * @module libs/integrations/woocommerce/src/domain/exceptions
 */
export class WooCommerceDuplicateSkuException extends Error {
  constructor(
    readonly sku: string,
    readonly connectionId: string,
  ) {
    super(`WooCommerce rejected SKU "${sku}" as already in use (connection ${connectionId})`);
    this.name = 'WooCommerceDuplicateSkuException';
    Error.captureStackTrace(this, this.constructor);
  }
}
