/**
 * Taxonomy Borrower Capability
 *
 * Optional sub-capability of `OfferManagerPort`. A destination that *borrows*
 * another platform's taxonomy (ERLI — accepts Allegro category/parameter ids
 * verbatim via `source:"allegro"`, ships no `CategoryBrowser` /
 * `CategoryParametersReader`) declares `implements TaxonomyBorrower` to name the
 * owner taxonomy it consumes. Resolution uses that value to reuse an
 * owner-authored category/attribute mapping with zero re-authoring
 * (ADR-023 §40/§83, #1045) — keeping the mechanism capability-driven, never
 * `platformType`-matched.
 *
 * See `offer-lister.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { TaxonomyOwner } from '../../types/taxonomy-owner.types';
import type { OfferManagerPort } from '../offer-manager.port';

export interface TaxonomyBorrower {
  /** The owner taxonomy whose already-resolved ids this destination reuses. */
  getBorrowedTaxonomy(): TaxonomyOwner;
}

export function isTaxonomyBorrower(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & TaxonomyBorrower {
  return typeof (adapter as Partial<TaxonomyBorrower>).getBorrowedTaxonomy === 'function';
}
