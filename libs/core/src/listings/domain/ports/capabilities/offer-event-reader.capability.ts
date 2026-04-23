/**
 * Offer Event Reader Capability
 *
 * Optional sub-capability of `OfferManagerPort` — adapters backed by an
 * incremental event journal (e.g. Allegro) declare `implements OfferEventReader`.
 * Cursor-based; preferred over `OfferLister` when both are available.
 *
 * See `offer-lister.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { OfferFeedInput, OfferFeedOutput } from '../../types/offer-feed.types';
import type { OfferManagerPort } from '../offer-manager.port';

export interface OfferEventReader {
  listOfferEvents(input: OfferFeedInput): Promise<OfferFeedOutput>;
}

export function isOfferEventReader(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & OfferEventReader {
  return typeof (adapter as Partial<OfferEventReader>).listOfferEvents === 'function';
}
