/**
 * Taxonomy Owner Resolution (#1979, ADR-037)
 *
 * The single definition of "which owner's tree does this marketplace connection
 * read?". Both `DestinationTaxonomyService` (which writes the rows) and the
 * scheduler (which elects one source connection per owner) call THIS function —
 * if the two ever disagreed, the scheduler would elect under one owner while the
 * service wrote rows under another, and nothing would surface the mismatch.
 *
 * Capability-driven, never a `platformType` switch: a borrower names its owner,
 * and an owning marketplace is identified by its `platformType` **validated
 * against** the closed `TaxonomyOwnerValues` set. That validation is the guard
 * that keeps ADR-037's "one value per distinct tree" rule enforceable — an
 * unvetted platform resolves to `null` rather than silently writing rows under a
 * bogus owner, which would be a data migration to undo.
 *
 * Domain-only — zero framework imports.
 *
 * @module libs/core/src/listings/domain
 */
import { isCategoryBrowser } from './ports/capabilities/category-browser.capability';
import { isTaxonomyBorrower } from './ports/capabilities/taxonomy-borrower.capability';
import type { OfferManagerPort } from './ports/offer-manager.port';
import { TaxonomyOwnerValues } from './types/taxonomy-owner.types';
import type { TaxonomyOwner } from './types/taxonomy-owner.types';

/**
 * @returns the owner whose tree this connection reads, or `null` when the
 * connection has no marketplace taxonomy source (a shop, or an unvetted
 * platform). `null` is a normal outcome, not an error — the caller decides
 * whether that means "try the shop path" or "skip this connection".
 */
export function resolveTaxonomyOwner(
  adapter: OfferManagerPort,
  platformType: string,
): TaxonomyOwner | null {
  // A borrower reads the OWNER's rows, so the tree is stored once and a
  // borrowing connection needs no special handling at any call site (#1045).
  if (isTaxonomyBorrower(adapter)) {
    return adapter.getBorrowedTaxonomy();
  }

  if (!isCategoryBrowser(adapter)) {
    return null;
  }

  return (TaxonomyOwnerValues as readonly string[]).includes(platformType)
    ? (platformType as TaxonomyOwner)
    : null;
}
