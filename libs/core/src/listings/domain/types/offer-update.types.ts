/**
 * Offer Field Update Types
 *
 * Domain types for partial offer field updates dispatched to marketplace adapters.
 * At least one field must be present in OfferFieldUpdate (enforced at the interface layer).
 *
 * @module libs/core/src/listings/domain/types
 */

export interface OfferDescriptionSectionItem {
  type: 'TEXT';
  content: string;
}

export interface OfferDescriptionSection {
  items: OfferDescriptionSectionItem[];
}

export interface OfferPriceUpdate {
  amount: string;
  currency: string;
}

export interface OfferDescriptionUpdate {
  sections: OfferDescriptionSection[];
}

/**
 * Partial offer field update payload.
 * All fields are optional but at least one must be present (validated at controller level).
 */
export interface OfferFieldUpdate {
  price?: OfferPriceUpdate;
  title?: string;
  description?: OfferDescriptionUpdate;
}
