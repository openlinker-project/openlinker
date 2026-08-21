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
  /**
   * The shop's tax rate, as the neutral percent-as-string code (#2249,
   * ADR-052). Propagated on an update the same way it is on a create, so an
   * offer's rate follows the catalogue rather than freezing at whatever it was
   * when the offer was first published.
   *
   * Optional and never inferred: absent means "this update does not touch the
   * rate", which is different from "the product has no rate" - an update path
   * must not be able to blank a rate an offer already carries. An adapter whose
   * platform marks the field as seller-frozen skips the write.
   */
  taxRate?: string;
}
