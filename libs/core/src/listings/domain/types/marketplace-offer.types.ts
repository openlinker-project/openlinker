/**
 * Marketplace Offer Types
 *
 * Neutral DTO emitted by `OfferReader.getOffer` — the single live offer the
 * listing detail page surfaces above the raw mapping fields. Every marketplace
 * adapter maps its native offer-detail response into this shape.
 *
 * `status` is a string passthrough rather than a closed union — different
 * marketplaces use different lifecycle vocabularies (Allegro: `ACTIVE`,
 * `ENDED`, `INACTIVE`, `BIDDING`; future ones will add their own). The FE
 * normalises into a known badge tone for the values it recognises and renders
 * unknown values as a neutral badge with the raw label.
 *
 * @module libs/core/src/listings/domain/types
 */

export interface MarketplaceOfferPrice {
  /** Decimal string, e.g. `"99.99"` — keep precision intact across the wire. */
  amount: string;
  /** ISO 4217 code. */
  currency: string;
}

export interface MarketplaceOfferCategory {
  id: string;
  /**
   * Human-readable label. Allegro's bare offer endpoint does not return the
   * category name (only the id) — adapters that can't fetch it cheaply leave
   * this undefined and the FE shows the id only.
   */
  name?: string;
}

export interface MarketplaceOffer {
  externalId: string;
  title: string;
  description?: string;
  /** Primary image URL — public, no auth required. */
  imageUrl?: string;
  price: MarketplaceOfferPrice;
  availableQuantity: number;
  status: string;
  category?: MarketplaceOfferCategory;
  /** Public buyer-facing URL the operator can open in a new tab. */
  marketplaceUrl?: string;
  /** ISO 8601 — last marketplace-side change. */
  updatedAt?: string;
}
