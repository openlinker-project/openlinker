/**
 * Mirakl Shop SKU Policy
 *
 * The `shop_sku` an offer OpenLinker creates is given (#4278). It is the key
 * stock, price and order lines use, so it must be stable for a variant and
 * unique in the shop. Derived from the OL variant id, `OL-` plus its 32 hex
 * characters (35 in all), short enough for Mirakl's SKU limit.
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */

const VARIANT_HEX = /([0-9a-f]{32})$/i;

export function deriveMiraklShopSku(internalVariantId: string): string {
  const hex = VARIANT_HEX.exec(internalVariantId.replace(/-/g, ''))?.[1];
  return hex ? `OL-${hex.toLowerCase()}` : `OL-${internalVariantId}`;
}
