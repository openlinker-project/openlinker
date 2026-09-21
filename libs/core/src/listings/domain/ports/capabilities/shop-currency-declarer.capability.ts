/**
 * Shop Currency Declarer Capability (#3203)
 *
 * Optional sub-capability of `ShopProductManagerPort` — the shop-side sibling
 * of `OfferCurrencyDeclarer`. A shop adapter that knows the store's configured
 * currency (typically a store-wide setting, not necessarily readable without
 * I/O) declares `implements ShopCurrencyDeclarer`.
 *
 * Kept OPTIONAL rather than folded onto the base port (unlike
 * `getDescriptionFormat`, which is required there because every publish
 * carries content): no shop adapter in this tree can answer it purely and
 * synchronously today, so requiring it would force every implementer to
 * either fabricate a value or throw. See `category-provisioner.capability.ts`
 * for the shared shop-side sub-capability convention.
 *
 * Consumed by `DestinationCurrencyResolutionService`
 * (`resolveShopDestinationCurrency`), probed AFTER `OfferCurrencyDeclarer` —
 * a connection resolves to at most one of `OfferManager` / `ProductPublisher`
 * in practice, mirroring `DescriptionFormatReadService`'s two-probe order.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { ShopProductManagerPort } from '../shop-product-manager.port';

export interface ShopCurrencyDeclarer {
  /**
   * The ISO 4217 currency this shop's catalogue prices in, or `null` when
   * the adapter cannot determine it.
   */
  getDestinationCurrency(): string | null;
}

export function isShopCurrencyDeclarer(
  adapter: ShopProductManagerPort,
): adapter is ShopProductManagerPort & ShopCurrencyDeclarer {
  return (
    typeof (adapter as Partial<ShopCurrencyDeclarer>).getDestinationCurrency === 'function'
  );
}
