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
 * carries content): no shop adapter in this tree implements it today. See
 * `category-provisioner.capability.ts` for the shared shop-side
 * sub-capability convention.
 *
 * **ASYNC, deliberately diverging from `OfferCurrencyDeclarer` (#3159
 * review, SUGGESTION).** A shop's real currency typically needs a live
 * read — e.g. a WooCommerce store-settings endpoint — rather than a fixed
 * marketplace-wide assumption like Allegro's PL-first `'PLN'`, so this
 * interface's method is `Promise<string | null>` from day one rather than
 * shipping sync and needing a breaking signature change the day a real
 * implementer (a store-currency reader) arrives.
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
   * the adapter cannot determine it. ASYNC — implementers that need a live
   * read (a store-settings call) are expected to cache it themselves, the
   * `DescriptionFormat` / `ResolveConcurrencyCeiling` precedent.
   */
  getDestinationCurrency(): Promise<string | null>;
}

export function isShopCurrencyDeclarer(
  adapter: ShopProductManagerPort,
): adapter is ShopProductManagerPort & ShopCurrencyDeclarer {
  return (
    typeof (adapter as Partial<ShopCurrencyDeclarer>).getDestinationCurrency === 'function'
  );
}
