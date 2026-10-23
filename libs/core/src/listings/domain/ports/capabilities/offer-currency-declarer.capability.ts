/**
 * Offer Currency Declarer Capability (#3203)
 *
 * Optional sub-capability of `OfferManagerPort` — an adapter that KNOWS its
 * connection's real settlement currency (a fixed fact about the marketplace
 * account, never a per-offer value) declares `implements OfferCurrencyDeclarer`.
 * Pure and synchronous: no I/O, no credentials, no network — the adapter
 * declares a value, mirroring `TaxonomyIdentityProvider.getTaxonomyIdentity()`
 * and `OfferFieldUpdater.getDescriptionFormat()` (ADR-046).
 *
 * Consumed by `DestinationCurrencyResolutionService`
 * (`resolveOfferDestinationCurrency`), which feeds
 * `price-change-block.types.ts`'s `readConnectionCurrency` callers a real
 * destination currency instead of the `Connection.config.currency` key that
 * (before #3203) no destination form ever wrote. `null` means "this adapter
 * cannot say" and the caller falls back to the config key, never to a guess —
 * the same "absent must never collapse into favourable" rule
 * `resolvePriceChangeBlockReason` already documents.
 *
 * See `offer-lister.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { OfferManagerPort } from '../offer-manager.port';

export interface OfferCurrencyDeclarer {
  /**
   * The ISO 4217 currency this connection settles in, or `null` when the
   * adapter cannot determine it (e.g. a platform whose currency varies by a
   * per-connection setting the adapter has not been given).
   */
  getDestinationCurrency(): string | null;
}

export function isOfferCurrencyDeclarer(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & OfferCurrencyDeclarer {
  return typeof (adapter as Partial<OfferCurrencyDeclarer>).getDestinationCurrency === 'function';
}
