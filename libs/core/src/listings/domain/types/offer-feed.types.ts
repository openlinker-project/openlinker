/**
 * Offer Feed Types
 *
 * Canonical offer feed types consumed by `OfferManagerPort.listOffers` /
 * `listOfferEvents`. Platform-neutral; marketplace adapters map their native
 * offer-listing responses into this shape.
 *
 * @module libs/core/src/listings/domain/types
 */

/**
 * Offer feed input (pagination options).
 *
 * cursor is opaque and adapter-specific (e.g., offset for Allegro).
 */
export interface OfferFeedInput {
  cursor?: string | null;
  limit: number;
}

/**
 * Single offer feed item with deterministic linking keys.
 */
export interface OfferFeedItem {
  offerId: string;
  externalRef?: string | null;
  sku?: string | null;
  ean?: string | null;
  gtin?: string | null;
  raw?: Record<string, unknown>;
}

/**
 * Offer feed output.
 */
export interface OfferFeedOutput {
  items: OfferFeedItem[];
  nextCursor: string | null;
}
