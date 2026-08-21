/**
 * Taxonomy Owner Resolution (#1979, ADR-037; identity reworked by #2063)
 *
 * The single definition of "which owner's tree does this marketplace connection
 * read?". Both `DestinationTaxonomyService` (which writes the rows) and the
 * scheduler (which elects one source connection per owner) call THIS function —
 * if the two ever disagreed, the scheduler would elect under one owner while the
 * service wrote rows under another, and nothing would surface the mismatch.
 *
 * **Identity is declared, never inferred.** #1979 identified an owning
 * marketplace by its `platformType`, validated against `TaxonomyOwnerValues`.
 * That is wrong whenever a platform splits its tree along an axis `platformType`
 * cannot express: every Allegro connection carries a required `environment` that
 * resolves to a different API host, so a sandbox and a production connection
 * collapsed onto one `'allegro'` scope, overwrote each other's rows, and the
 * watermark sweep deleted the loser's tree on every completing run (#2063).
 *
 * So `TaxonomyOwnerValues` no longer gates anything at runtime — it is the
 * compile-time vocabulary adapters are typed against. An adapter that declares
 * nothing resolves to `null`, which is the fail-safe direction: the sync skips
 * it rather than writing rows under a guessed owner, which would be a data
 * migration to undo.
 *
 * Note there is no `isCategoryBrowser` conjunct. Reading a tree and being able
 * to REFRESH it are separate questions — a borrower without catalogue
 * credentials reads the owner's rows perfectly well (ADR-031) — so browsing is
 * answered lazily, and only where it matters, by
 * `DestinationTaxonomyService.marketplaceBrowseFn`.
 *
 * Domain-only — zero framework imports.
 *
 * @module libs/core/src/listings/domain
 */
import { isTaxonomyBorrower } from './ports/capabilities/taxonomy-borrower.capability';
import { isTaxonomyIdentityProvider } from './ports/capabilities/taxonomy-identity-provider.capability';
import type { OfferManagerPort } from './ports/offer-manager.port';
import type { TaxonomyOwner } from './types/taxonomy-owner.types';

/**
 * @returns the owner whose tree this connection reads, or `null` when the
 * connection declares no marketplace taxonomy identity (a shop, or a
 * marketplace adapter that has not yet adopted `TaxonomyIdentityProvider`).
 * `null` is a normal outcome, not an error — the caller decides whether that
 * means "try the shop path" or "skip this connection".
 */
export function resolveTaxonomyOwner(adapter: OfferManagerPort): TaxonomyOwner | null {
  // Borrower FIRST: it reads the OWNER's rows, so the tree is stored once and a
  // borrowing connection needs no special handling at any call site (#1045). An
  // adapter somehow declaring both must still defer to the owner it borrows.
  //
  // The returned owner is used VERBATIM, deliberately, and this is where the
  // taxonomy projection parts ways with mapping resolution (#2210). A borrower
  // may name an environment-qualified owner (`allegro:sandbox`, #2063); mapping
  // resolution falls back from the qualified owner to the bare one, because a
  // mapping row written before the qualification existed is still the operator's
  // own intent and reusing it is right. A projection row is not: falling back
  // would hand a sandbox connection the PRODUCTION category tree, and an
  // operator picking a category that does not exist on the environment they are
  // publishing to is worse than an empty picker that says the tree has not
  // synced. Empty is honest here; borrowed-and-wrong is not.
  if (isTaxonomyBorrower(adapter)) {
    return adapter.getBorrowedTaxonomy();
  }

  if (isTaxonomyIdentityProvider(adapter)) {
    return adapter.getTaxonomyIdentity();
  }

  return null;
}
