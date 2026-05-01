/**
 * Offer Reader Capability
 *
 * Optional sub-capability of `OfferManagerPort` — adapters that can fetch a
 * single offer's live state (title, image, price, qty, status, …) declare
 * `implements OfferReader`. Consumed by the listing-detail page (#464) to
 * surface live marketplace state above the raw identifier-mapping fields.
 *
 * Naming and shape mirror sibling capabilities in this directory; see
 * `offer-lister.capability.ts` for the convention call-out.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { MarketplaceOffer } from '../../types/marketplace-offer.types';
import type { OfferManagerPort } from '../offer-manager.port';

export interface OfferReader {
  getOffer(input: { externalId: string }): Promise<MarketplaceOffer>;
}

export function isOfferReader(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & OfferReader {
  return typeof (adapter as Partial<OfferReader>).getOffer === 'function';
}
