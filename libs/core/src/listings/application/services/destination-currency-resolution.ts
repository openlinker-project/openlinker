/**
 * Destination Currency Resolution (#3203)
 *
 * Resolves a destination's declared currency off an adapter the caller
 * already holds — the `description-format-resolution.ts` shape applied to
 * currency instead of description grammar.
 *
 * ## Why the resolution is defensive
 *
 * `getDestinationCurrency()` is a member of the OPTIONAL `OfferCurrencyDeclarer`
 * / `ShopCurrencyDeclarer` sub-capabilities, so an adapter that declares
 * neither — every adapter in this tree today except Allegro and Erli —
 * resolves `null` here, which the caller (`DestinationCurrencyResolutionService`)
 * reads as "try the next capability, then fall back to
 * `Connection.config.currency`". The `is*CurrencyDeclarer` guards test only
 * the method's presence (the ADR-046 probe-not-trust precedent), so an
 * out-of-tree plugin compiled against an older `libs/core` degrades gracefully
 * — a declared `null` value and an undeclared capability both resolve to
 * "unknown here", never conflated with an error.
 *
 * @module libs/core/src/listings/application/services
 */
import { isOfferCurrencyDeclarer } from '../../domain/ports/capabilities/offer-currency-declarer.capability';
import { isShopCurrencyDeclarer } from '../../domain/ports/capabilities/shop-currency-declarer.capability';
import type { OfferManagerPort } from '../../domain/ports/offer-manager.port';
import type { ShopProductManagerPort } from '../../domain/ports/shop-product-manager.port';

/**
 * The currency a marketplace destination declares, or `null` when it
 * declares nothing. Narrow the adapter you already resolved — never resolve
 * a second one for this.
 */
export function resolveOfferDestinationCurrency(adapter: OfferManagerPort): string | null {
  return isOfferCurrencyDeclarer(adapter) ? adapter.getDestinationCurrency() : null;
}

/**
 * The currency a shop destination declares, or `null` when it declares
 * nothing (every in-tree shop adapter today). `ShopCurrencyDeclarer` is
 * ASYNC (#3159 review, SUGGESTION), unlike its marketplace sibling above —
 * a shop's real settlement currency typically needs a live read (e.g. a
 * WooCommerce store-settings call), where Allegro/Erli can answer from a
 * fixed constant with no I/O at all.
 */
export async function resolveShopDestinationCurrency(
  adapter: ShopProductManagerPort,
): Promise<string | null> {
  return isShopCurrencyDeclarer(adapter) ? adapter.getDestinationCurrency() : null;
}
