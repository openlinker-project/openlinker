/**
 * Shop Product Price Updater Capability (#3505, G01-10)
 *
 * Optional sub-capability of `ShopProductManagerPort` — a shop adapter that
 * can change the price of an already-published product WITHOUT re-sending the
 * rest of it declares `implements ShopProductPriceUpdater`.
 *
 * `publishProduct` is a full upsert: stock, name, description, categories and
 * attributes ride along with the price. A price-only change sent through it
 * overwrites the shop's stock with OL's (and switches stock management on),
 * and overwrites the shop's title / description with the master's whenever no
 * earlier publish snapshot exists. `PriceChangeApplyService` uses this
 * capability instead whenever the adapter has it, and falls back to the full
 * guarded publish otherwise.
 *
 * Contract: the write carries the price fields and NOTHING else. Failures map
 * to the same neutral exceptions as `publishProduct` —
 * `ProductPublishTargetNotFoundException` for a product gone shop-side,
 * `ProductPublishRejectedException` for a terminal rejection; transport
 * failures propagate for the runner's retry path.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { ShopProductManagerPort } from '../shop-product-manager.port';
import type { UpdateShopProductPriceCommand } from '../../types/shop-product-price-update.types';

export interface ShopProductPriceUpdater {
  updateShopProductPrice(cmd: UpdateShopProductPriceCommand): Promise<void>;
}

export function isShopProductPriceUpdater(
  adapter: ShopProductManagerPort,
): adapter is ShopProductManagerPort & ShopProductPriceUpdater {
  return (
    typeof (adapter as Partial<ShopProductPriceUpdater>).updateShopProductPrice === 'function'
  );
}
