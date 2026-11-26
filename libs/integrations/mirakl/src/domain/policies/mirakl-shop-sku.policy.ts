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

/**
 * The seller's product code (`CATALOG_CODE`) on a card OpenLinker creates.
 * It names the card in the operator's error report, so it is derived from the
 * same variant id. An operator may cap it below the shop SKU (Empik: 26
 * characters), so the SKU is shortened to the cap by dropping the end of its
 * hex part; 23 hex characters still leave about 92 bits, so two variants of
 * one seller do not collide.
 */
export function deriveMiraklCatalogCode(shopSku: string, maxLength: number): string {
  return shopSku.length <= maxLength ? shopSku : shopSku.slice(0, maxLength);
}
