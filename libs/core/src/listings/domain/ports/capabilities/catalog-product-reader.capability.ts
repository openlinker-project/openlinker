/**
 * Catalog Product Reader Capability
 *
 * Optional sub-capability of `OfferManagerPort` — adapters that expose a
 * marketplace catalog (Allegro `/sale/products`, eBay product-identifier
 * lookup, etc.) declare `implements CatalogProductReader`.
 *
 * Two methods because ambiguous matches don't need eager detail fetches —
 * the caller only pays the detail cost after the operator picks one.
 *
 * Adapters MAY require `categoryId` on `findProductsByBarcode` (see
 * `FindProductsByBarcodeInput.categoryId` jsdoc). When required and absent,
 * the adapter MUST return `{ kind: 'no_match' }` rather than throwing.
 *
 * See `category-barcode-matcher.capability.ts` for the shared naming
 * convention; both capabilities complement each other in the EAN-driven
 * wizard prefill flow (#631 resolves category, this capability resolves
 * the catalog product within that category).
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { OfferManagerPort } from '../offer-manager.port';
import type {
  CatalogProduct,
  CatalogProductMatchResult,
  FindProductsByBarcodeInput,
} from '../../types/catalog-product.types';

export interface CatalogProductReader {
  /**
   * Look up catalog products by barcode. Returns a 3-state discriminated
   * union; `unique` carries the eager-fetched full product, `ambiguous`
   * carries summaries only.
   */
  findProductsByBarcode(input: FindProductsByBarcodeInput): Promise<CatalogProductMatchResult>;

  /**
   * Fetch a single catalog product by id. Adapters throw
   * `CatalogProductNotFoundException` when the marketplace returns 404.
   */
  getProduct(input: { productId: string }): Promise<CatalogProduct>;
}

export function isCatalogProductReader(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & CatalogProductReader {
  const partial = adapter as Partial<CatalogProductReader>;
  return (
    typeof partial.findProductsByBarcode === 'function' &&
    typeof partial.getProduct === 'function'
  );
}
