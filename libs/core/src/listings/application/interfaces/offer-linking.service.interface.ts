/**
 * Offer Linking Service Interface
 *
 * Contract for deterministic linking of marketplace offers to internal
 * sellable items (product variants) via a fallback chain: externalRef →
 * sku → ean → gtin.
 *
 * @module libs/core/src/listings/application/interfaces
 */

import type { OfferFeedItem } from '../../domain/types/offer-feed.types';
import type { OfferLinkingLookups, OfferLinkingResult } from '../types/offer-linking.types';

export interface IOfferLinkingService {
  /**
   * Resolve a single offer to an internal variant using the pre-built lookup
   * tables. Returns `'linked'` with the variant id and the matching method,
   * or `'skipped'` with a reason (ambiguous lookup or no deterministic match).
   */
  linkOffer(item: OfferFeedItem, lookups: OfferLinkingLookups): OfferLinkingResult;
}
