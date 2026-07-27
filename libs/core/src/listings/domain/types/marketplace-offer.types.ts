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
import type { CategoryParameterSection } from './category-parameter.types';

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

/**
 * One filled category-parameter value on a live offer (#1482).
 *
 * Reuses the neutral section vocabulary from `CategoryParameterSection`
 * (#415/#419): `'offer'` for offer-section parameters, `'product'` for
 * product-section ones (Brand, Model, manufacturer code, ...). `name` stays
 * optional - some marketplaces omit it on reads and consumers fall back to
 * the id. `values` carries human-readable values when provided; `valuesIds`
 * carries dictionary value ids; `rangeValue` carries integer/float range
 * parameters as a neutral string pair.
 */
export interface MarketplaceOfferParameter {
  id: string;
  name?: string;
  values: string[];
  valuesIds?: string[];
  rangeValue?: { from: string; to: string };
  section: CategoryParameterSection;
}

/**
 * Product-set linkage entry for catalog-grouped offers (#1482) - e.g.
 * Allegro's auto-grouping links each offer to a catalog product card.
 * Both fields are optional because inline (non-linked) entries carry no
 * stable product id and some marketplaces don't report a quantity.
 */
export interface MarketplaceOfferProductSetItem {
  productId?: string;
  quantity?: number;
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
  /**
   * ISO 8601 — when the offer's marketplace-side validity ends (Allegro:
   * `publication.endingAt`). Optional because not every marketplace publishes
   * a fixed end date. Distinct from a "last modified" timestamp — the
   * Allegro offer endpoint doesn't expose one cheaply, so we surface the
   * scheduled end instead because that is what operators actually need to
   * see on the detail page.
   */
  endsAt?: string;
  /**
   * Filled category-parameter values (#1482). Absent when the adapter's
   * native read carries no parameter data - existing consumers are
   * unaffected.
   */
  parameters?: MarketplaceOfferParameter[];
  /** Product-set linkage for catalog-grouped offers (#1482). */
  productSet?: MarketplaceOfferProductSetItem[];
}
