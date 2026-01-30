/**
 * Marketplace Offer Feed Types
 *
 * Canonical offer feed types for marketplace integrations.
 *
 * @module libs/core/src/integrations/domain/types
 */

/**
 * Offer feed input (pagination options).
 *
 * cursor is opaque and adapter-specific (e.g., offset for Allegro).
 */
export interface MarketplaceOfferFeedInput {
  cursor?: string | null;
  limit: number;
}

/**
 * Single offer feed item with deterministic linking keys.
 */
export interface MarketplaceOfferFeedItem {
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
export interface MarketplaceOfferFeedOutput {
  items: MarketplaceOfferFeedItem[];
  nextCursor: string | null;
}
