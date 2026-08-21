/**
 * Shop Product URL Helper (#2255)
 *
 * Builds a deep link to a product in the shop that owns it, or reports honestly
 * that none can be built.
 *
 * **For PrestaShop there cannot be one.** The admin directory is randomised at
 * install and editing needs a per-employee token, so any URL OpenLinker
 * constructed would be a guess. WooCommerce is constructible, but only by
 * reading the store base URL out of the untyped connection config.
 *
 * A `null` return is therefore a real answer, not a failure: the caller renders
 * a copyable SKU and a plain sentence instead. A button whose href is a guess is
 * worse than no button - it sends the operator somewhere wrong while looking
 * like it knows where it is going.
 *
 * Precedent: `features/listings/lib/allegro-seller-panel-url.ts`, which is
 * likewise a pure derivation with an honest `null`.
 *
 * @module apps/web/src/features/products/lib
 */

/**
 * @param platformType - the connection's platform; anything but a shop OL can
 *   link into returns `null`
 * @param config - the connection's untyped config blob; WooCommerce's store URL
 *   is read from it defensively, because nothing types it
 * @param externalId - the product's id in that shop
 */
export function buildShopProductUrl(
  platformType: string | undefined,
  config: Record<string, unknown> | undefined,
  externalId: string | null | undefined,
): string | null {
  if (!platformType || !externalId) return null;

  if (platformType === 'woocommerce') {
    const base = readStoreBaseUrl(config);
    if (!base) return null;
    // WordPress's post editor is stable across installs, unlike PrestaShop's
    // admin directory - this is why one is constructible and the other is not.
    return `${base}/wp-admin/post.php?post=${encodeURIComponent(externalId)}&action=edit`;
  }

  // PrestaShop and everything else: no constructible URL. Deliberate, and the
  // caller's copy says so rather than rendering a dead link.
  return null;
}

/** The store's public base URL, read defensively out of an untyped config. */
function readStoreBaseUrl(config: Record<string, unknown> | undefined): string | null {
  const candidate = config?.baseUrl ?? config?.storeUrl ?? config?.siteUrl;
  if (typeof candidate !== 'string' || candidate.trim() === '') return null;
  return candidate.trim().replace(/\/+$/, '');
}
