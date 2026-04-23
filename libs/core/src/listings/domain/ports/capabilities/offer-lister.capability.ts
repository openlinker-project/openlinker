/**
 * Offer Lister Capability
 *
 * Optional sub-capability of `OfferManagerPort` — adapters that can page through
 * the marketplace's current offer catalogue declare `implements OfferLister`.
 * Call sites narrow support via `isOfferLister(adapter)`; after the guard the
 * `listOffers` method is compile-time-guaranteed to be present and callable.
 *
 * Naming: sub-capabilities deliberately drop the `Port` suffix — they layer onto
 * `OfferManagerPort`, they are not independent top-level ports. Do not rename to
 * `OfferListerPort`. This convention is shared by every file in this directory.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { OfferFeedInput, OfferFeedOutput } from '../../types/offer-feed.types';
import type { OfferManagerPort } from '../offer-manager.port';

export interface OfferLister {
  listOffers(input: OfferFeedInput): Promise<OfferFeedOutput>;
}

export function isOfferLister(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & OfferLister {
  return typeof (adapter as Partial<OfferLister>).listOffers === 'function';
}
