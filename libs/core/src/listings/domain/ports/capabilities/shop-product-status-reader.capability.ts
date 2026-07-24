/**
 * Shop Product Status Reader Capability (#1845)
 *
 * Optional sub-capability of `ShopProductManagerPort` - shop adapters that can
 * read the current shop-side publication status of a previously-published
 * product declare `implements ShopProductStatusReader`. Used by the steady-state
 * `ShopStatusSyncService` to detect a product unpublished / trashed shop-side.
 * The shop-side sibling of `OfferStatusReader`.
 *
 * Returns the neutral observation only (`{ publicationStatus }`); mapping the
 * shop's native status vocabulary onto the neutral `ShopPublicationStatus` union
 * happens in the adapter. Adapters should return `publicationStatus: 'removed'`
 * when the shop cannot find the product id (e.g. a 404 / trashed). Other
 * transport-level failures should propagate so the runner's transient-retry path
 * absorbs the blip.
 *
 * `getShopVariationStatus` is the variation-aware sibling (whole-epic review
 * finding #2): for a grouped/multi-variant publish (#1836), a `ListingCreationRecord`'s
 * `externalProductId` is the CHILD variation's id, which lives at a different
 * shop-native resource than a standalone simple product (WooCommerce:
 * `products/{parentId}/variations/{id}`, not `products/{id}`) — calling
 * `getShopProductStatus` with a variation id 404s and would be misread as
 * `removed`. Optional (not every reader implements grouped publishing, and not
 * every `ShopStatusSyncService` record is a grouped variation) so existing
 * simple-product-only readers stay unchanged; `ShopStatusSyncService` calls it
 * only when it resolves a parent id for the record's product.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { ShopProductStatusReadResult } from '../../types/shop-product-status.types';
import type { ShopProductManagerPort } from '../shop-product-manager.port';

export interface ShopProductStatusReader {
  getShopProductStatus(externalProductId: string): Promise<ShopProductStatusReadResult>;
  /**
   * Read the live status of a grouped-publish CHILD variation, scoped under its
   * parent. Optional: only meaningful for adapters that support grouped/
   * multi-variant publishing (#1836, e.g. WooCommerce `type:'variable'` +
   * `products/{parentId}/variations/{id}`).
   */
  getShopVariationStatus?(
    externalParentProductId: string,
    externalVariationId: string,
  ): Promise<ShopProductStatusReadResult>;
}

export function isShopProductStatusReader(
  adapter: ShopProductManagerPort,
): adapter is ShopProductManagerPort & ShopProductStatusReader {
  return (
    typeof (adapter as Partial<ShopProductStatusReader>).getShopProductStatus === 'function'
  );
}
