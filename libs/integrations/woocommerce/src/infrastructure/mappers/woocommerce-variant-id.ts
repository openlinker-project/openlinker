/**
 * WooCommerce variant-id helpers
 *
 * Centralizes the synthetic-variant marker convention shared by the
 * product-master, inventory-master, and order-processor adapters. A WooCommerce
 * "simple product" has no WC variation, so OpenLinker maps it to a deterministic
 * synthetic ProductVariant whose external id is `product:{wcProductId}` (matching
 * the PrestaShop precedent). A "variable product" maps each WC variation to a
 * variant keyed by the numeric WC variation id.
 *
 * Extracted so the marker literal cannot drift between the call sites that build
 * or detect it — the same rationale behind prestashop-variant-id.ts. Before this
 * was extracted, the `product:{wcId}` string was hand-written in three adapters,
 * and the order-processor duplicated the `startsWith('product:')` detection
 * inline.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/mappers
 * @see prestashop-variant-id for the PrestaShop precedent
 */

/** Prefix marking a synthetic variant of a WooCommerce simple product. */
export const WOOCOMMERCE_SYNTHETIC_VARIANT_PREFIX = 'product:';

/**
 * Builds the deterministic synthetic-variant external id for a simple product.
 * Stable per WC product id, so repeat syncs resolve the same OpenLinker variant.
 */
export function buildSyntheticVariantExternalId(wcProductId: number | string): string {
  return `${WOOCOMMERCE_SYNTHETIC_VARIANT_PREFIX}${wcProductId}`;
}

/**
 * True when an external variant id is a synthetic simple-product marker rather
 * than a real WC variation id. Callers skip variation-id coercion for these — a
 * simple product's line item is the product itself, with no `variation_id`.
 */
export function isSyntheticVariantExternalId(raw: string | null | undefined): boolean {
  return typeof raw === 'string' && raw.startsWith(WOOCOMMERCE_SYNTHETIC_VARIANT_PREFIX);
}
