/**
 * WooCommerce Offer Manager Wire Types
 *
 * Request-body shape for the stock write-back (#1498). Matches the WC REST
 * v3 product update contract — the same `manage_stock` / `stock_quantity`
 * pair the product publisher sends at publish time.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/offer-manager
 */

/**
 * Sparse `PUT /products/{id}` body for an absolute stock set. `manage_stock`
 * is always re-asserted so a shop-side flip back to unmanaged stock does not
 * silently disable the write-back (#1498 authority model: master wins).
 */
export interface WooCommerceStockUpdateBody {
  manage_stock: true;
  stock_quantity: number;
}
