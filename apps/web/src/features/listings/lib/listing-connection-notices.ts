/**
 * Connection-level listing notices (#2231)
 *
 * Some channel refusals describe the SHOP rather than the product - unverified,
 * suspended, switched off. The channel reports those against every one of the
 * shop's offers, so per-row rendering stamps one sentence on every row and
 * buries the single fact an operator can act on. This derives them into one
 * notice per affected connection instead.
 *
 * Derived from the rows the page has already fetched - no extra request, and no
 * new endpoint. That is also why the count is stated as "of the listings shown":
 * the list is paged and filtered, so the page cannot honestly claim a total for
 * the connection, and a number that quietly means "this page" would be worse
 * than saying which number it is.
 *
 * @module apps/web/src/features/listings/lib
 */
import type { OfferMapping, OfferValidationProblem } from '../api/listings.types';
import { readAccountScopedProblems } from './listing-problems';

export interface ListingConnectionNotice {
  connectionId: string;
  /** The connection's own name when known, else its id - never a platform label. */
  connectionLabel: string;
  /** Distinct shop-level problems, first-seen order (the adapter ranks them). */
  problems: OfferValidationProblem[];
  /** How many of the listings currently shown carry the problem. */
  affectedShownCount: number;
}

/**
 * One notice per connection whose rows carry a shop-level problem.
 *
 * Pure and order-stable: connections appear in the order their first affected
 * row does, so the notice stack does not reshuffle between pages.
 */
export function deriveListingConnectionNotices(
  rows: readonly OfferMapping[],
  connectionNames: ReadonlyMap<string, string>
): ListingConnectionNotice[] {
  const byConnection = new Map<string, ListingConnectionNotice>();
  const seenCodes = new Map<string, Set<string>>();

  for (const row of rows) {
    const problems = readAccountScopedProblems(row);
    if (problems.length === 0) continue;

    let notice = byConnection.get(row.connectionId);
    if (!notice) {
      notice = {
        connectionId: row.connectionId,
        connectionLabel: connectionNames.get(row.connectionId) ?? row.connectionId,
        problems: [],
        affectedShownCount: 0,
      };
      byConnection.set(row.connectionId, notice);
      seenCodes.set(row.connectionId, new Set());
    }
    notice.affectedShownCount += 1;

    // Deduplicated by code, because every affected row repeats the same list -
    // that repetition is the whole reason this notice exists.
    //
    // The `message` fallback is DEFENSIVE, not a live path: a codeless problem
    // can only come from the flattened-messages fallback, which is always
    // offer-scoped and so never reaches this function. It stays because the key
    // must not collapse two distinct problems onto `undefined` if that ever
    // stops being true.
    const codes = seenCodes.get(row.connectionId) as Set<string>;
    for (const problem of problems) {
      const key = problem.code ?? problem.message;
      if (codes.has(key)) continue;
      codes.add(key);
      notice.problems.push(problem);
    }
  }

  return [...byConnection.values()];
}
