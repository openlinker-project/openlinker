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
  /**
   * Whether this destination may have its EAN catalogue lookups resolved
   * through a PEER connection that owns the borrowed taxonomy (#2210).
   *
   * OPTIONAL, and absent means yes - so a borrower that has no such switch says
   * nothing. It exists because borrowing the owner's *live catalogue* is a
   * stronger act than reusing the owner's *authored mappings*: it makes real
   * marketplace calls on a third connection's credentials and rate-limit budget,
   * so a destination whose operator has switched that access off has to be able
   * to say so. Returning `false` degrades the resolve to the same outcome as
   * "no owner connection exists" - never an error - and leaves mapping reuse
   * (#1045, no network) untouched, because that is a different question.
   */
  allowsBorrowedCatalogueLookup?(): boolean;
}

export function isTaxonomyBorrower(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & TaxonomyBorrower {
  return typeof (adapter as Partial<TaxonomyBorrower>).getBorrowedTaxonomy === 'function';
}
