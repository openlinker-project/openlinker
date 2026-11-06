/**
 * Shopify GID Policy
 *
 * OpenLinker stores the NUMERIC tail of a Shopify global id
 * (`gid://shopify/Product/123` -> `123`) as the external id of every mapping:
 * it is what webhook payloads and the admin URL carry, and it keeps external
 * ids free of the `:` the identifier-mapping keys are joined with. The GID is
 * rebuilt at the GraphQL boundary only.
 *
 * @module libs/integrations/shopify/src/domain/policies
 */

const GID = /^gid:\/\/shopify\/([A-Za-z]+)\/([^/?]+)/;

export type ShopifyGidType =
  | 'Product'
  | 'ProductVariant'
  | 'InventoryItem'
  | 'Location'
  | 'Order'
  | 'LineItem'
  | 'Customer'
  | 'FulfillmentOrder'
  | 'Collection'
  | 'Return'
  | 'Shop';

/** `123` or an already-built GID -> `gid://shopify/{type}/123`. */
export function toShopifyGid(type: ShopifyGidType, id: string): string {
  return GID.test(id) ? id : `gid://shopify/${type}/${id}`;
}

/** `gid://shopify/{type}/123` -> `123`; a value that is not a GID is returned unchanged. */
export function fromShopifyGid(gid: string): string {
  const match = GID.exec(gid);
  return match === null ? gid : match[2];
}
