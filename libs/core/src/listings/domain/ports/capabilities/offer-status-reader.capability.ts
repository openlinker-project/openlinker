/**
 * Offer Status Reader Capability
 *
 * Optional sub-capability of `OfferManagerPort` — adapters that can read the
 * current marketplace-side status of a previously-created offer declare
 * `implements OfferStatusReader`. Used by the offer-creation poller (#447) to
 * follow up on creates that returned with the marketplace still validating
 * (Allegro `publication.status: ACTIVATING`).
 *
 * Returns the raw observation only (`{ publicationStatus, validationErrors }`).
 * Mapping to OL's `OfferCreationStatus` lifecycle (`'active' | 'draft' |
 * 'validating' | 'failed' | …`) is owned by `OfferStatusPollService`, not by
 * the adapter — keeps this contract platform-agnostic.
 *
 * Adapters that lack a status read should throw
 * `OfferNotFoundOnMarketplaceException` if the marketplace cannot find the
 * offer id (e.g. 404). Other transport-level failures should propagate so the
 * runner's transient-retry path absorbs the blip.
 *
 * See `offer-lister.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { OfferStatusReadResult } from '../../types/offer-status-read.types';
import type { OfferManagerPort } from '../offer-manager.port';

export interface OfferStatusReader {
  getOfferStatus(externalOfferId: string): Promise<OfferStatusReadResult>;
}

export function isOfferStatusReader(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & OfferStatusReader {
  return typeof (adapter as Partial<OfferStatusReader>).getOfferStatus === 'function';
}
