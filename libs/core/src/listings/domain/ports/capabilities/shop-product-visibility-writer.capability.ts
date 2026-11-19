/**
 * Shop Product Visibility Writer Capability (#3962)
 *
 * Optional sub-capability of `ShopProductManagerPort` — a shop adapter that
 * can take a published product off sale and put it back WITHOUT re-sending
 * the rest of it declares `implements ShopProductVisibilityWriter`.
 *
 * Used when a product is deleted at the master: OpenLinker hides it on every
 * shop it was published to (WooCommerce draft, Shoper / PrestaShop inactive)
 * instead of relying on a stock write, which most shop connections cannot
 * make. The product and its history stay on the shop; only its visibility
 * changes, so the operator can put it back on sale later.
 *
 * Contract: the write changes visibility and NOTHING else. Failures map to
 * the same neutral exceptions as `publishProduct` —
 * `ProductPublishTargetNotFoundException` for a product gone shop-side,
 * `ProductPublishRejectedException` for a terminal rejection; transport
 * failures propagate for the caller's retry path.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { ShopProductManagerPort } from '../shop-product-manager.port';
import type { SetShopProductVisibilityCommand } from '../../types/shop-product-visibility.types';

export interface ShopProductVisibilityWriter {
  setShopProductVisibility(cmd: SetShopProductVisibilityCommand): Promise<void>;
}

export function isShopProductVisibilityWriter(
  adapter: ShopProductManagerPort,
): adapter is ShopProductManagerPort & ShopProductVisibilityWriter {
  return (
    typeof (adapter as Partial<ShopProductVisibilityWriter>).setShopProductVisibility === 'function'
  );
}
