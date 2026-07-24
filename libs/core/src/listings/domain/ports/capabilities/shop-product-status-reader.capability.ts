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
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { ShopProductStatusReadResult } from '../../types/shop-product-status.types';
import type { ShopProductManagerPort } from '../shop-product-manager.port';

export interface ShopProductStatusReader {
  getShopProductStatus(externalProductId: string): Promise<ShopProductStatusReadResult>;
}

export function isShopProductStatusReader(
  adapter: ShopProductManagerPort,
): adapter is ShopProductManagerPort & ShopProductStatusReader {
  return (
    typeof (adapter as Partial<ShopProductStatusReader>).getShopProductStatus === 'function'
  );
}
