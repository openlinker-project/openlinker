/**
 * Product Tax Rate Reader Capability (#2054, ADR-063)
 *
 * Optional sub-capability of `ProductMasterPort`: the master states the tax
 * rate a product carries. A master that can answer declares
 * `implements ProductTaxRateReader`; one that cannot simply does not, and the
 * catalogue row for its products stays *never checked* rather than being
 * recorded as *no rate* - a distinction the whole gate depends on.
 *
 * Naming: sub-capabilities drop the `Port` suffix - they layer onto
 * `ProductMasterPort` rather than being independent top-level ports.
 *
 * Guard-only, for the same reason as `ModifiedProductLister`: a connection's
 * `enabledCapabilities` is stamped at create and never retro-filled, so gating
 * on a newly advertised name would silently answer nothing for every connection
 * that already exists. Call sites narrow an already-dispatched `ProductMaster`
 * adapter with `isProductTaxRateReader`.
 *
 * @module libs/core/src/products/domain/ports/capabilities
 * @see {@link ProductMasterPort} for the base port
 * @see {@link TaxRateResolution} for the answer shape
 */
import type { TaxRateResolution } from '../../types/tax-rate.types';
import type { ProductMasterPort } from '../product-master.port';

export interface ReadProductTaxRateInput {
  /** Internal OpenLinker product id. The adapter resolves it to its own id. */
  productId: string;
  /**
   * Internal variant id, when the caller wants the variant's own rate.
   *
   * A master that keys tax on the product alone (PrestaShop does) ignores it
   * and answers the product's rate; the caller stores that against the product
   * row, so the absent variant override is a fact rather than a gap. A master
   * that keys per variant (WooCommerce can) answers the variant's own.
   */
  variantId?: string;
}

export interface ProductTaxRateReader {
  /**
   * State the tax rate this product carries.
   *
   * MUST return `kind: 'unknown'` rather than a `'0'` code whenever the read
   * did not establish the rate. A zero code is reserved for a rate the shop
   * deliberately set to zero - "No tax" in PrestaShop's own product dropdown,
   * or a WooCommerce `tax_status: 'none'`. Reading the first as the second
   * mis-taxes the sale silently, which is the failure this whole contract
   * exists to prevent (#2052 named it on the order-create path).
   *
   * A transport failure propagates as a thrown error, unchanged, so the caller
   * can retry. `unknown` means the master answered and the answer did not name
   * a rate - a condition an operator fixes in the shop, not a retry.
   *
   * On a variant read, `kind: 'inherited'` says the variant defers to the
   * product. The caller stores nothing for it, so the override stays absent
   * rather than becoming a stale duplicate of the product's code.
   */
  readProductTaxRate(input: ReadProductTaxRateInput): Promise<TaxRateResolution>;

  /**
   * Whether this master keys tax **per variant**.
   *
   * PrestaShop keys on the product, so every variant read there would return
   * the product's rate and storing it as a variant override would be noise.
   * Optional: absent means product-keyed.
   */
  readsTaxRatePerVariant?(): boolean;
}

export function isProductTaxRateReader(
  adapter: ProductMasterPort
): adapter is ProductMasterPort & ProductTaxRateReader {
  return typeof (adapter as Partial<ProductTaxRateReader>).readProductTaxRate === 'function';
}
