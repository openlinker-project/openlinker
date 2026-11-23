/**
 * Mirakl Offer Types
 *
 * Wire shapes of the Mirakl offer endpoints #4277 reads: OF21
 * (`GET /api/offers`) answers a page of these. Field names follow the Empik
 * staging response (SPIKE-4268); every field is optional because an
 * operator may leave any of them out.
 *
 * @module libs/integrations/mirakl/src/domain/types
 */

/** One product reference on an offer, e.g. `{ reference_type: 'EAN', reference: '978...' }`. */
export interface MiraklProductReference {
  readonly reference?: string;
  readonly reference_type?: string;
}

/** One offer as OF21 returns it. */
export interface MiraklOffer {
  /** Mirakl's own numeric id; OpenLinker keys offers by `shop_sku` instead. */
  readonly offer_id?: number;
  /** The seller's SKU: the offer key in STO01, PRI01 and on order lines. */
  readonly shop_sku?: string;
  readonly product_sku?: string;
  readonly product_title?: string;
  readonly product_references?: readonly MiraklProductReference[];
  readonly quantity?: number;
  readonly price?: number;
  readonly currency_iso_code?: string;
  readonly active?: boolean;
  /** Why an inactive offer cannot sell, e.g. `ZERO_QUANTITY`. */
  readonly inactivity_reasons?: readonly string[];
  readonly state_code?: string;
}

/** OF21 page envelope. */
export interface MiraklOffersPage {
  readonly offers?: readonly MiraklOffer[];
  readonly total_count?: number;
}
