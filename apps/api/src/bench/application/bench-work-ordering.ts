/**
 * Bench work ordering (#2416, `W3b-3`, story B2)
 *
 * *"The list is ordered by urgency"* — the whole of that rule, as one pure
 * comparator with no I/O and no clock.
 *
 * Pure and separate from the service for the reason the repository's other
 * rule modules are: the ordering is the part a reader must be able to check
 * against the story, and a comparator buried in a service method is checked by
 * nobody. It qualifies for `engineering-standards.md`'s pure-rule exception on
 * all three counts.
 *
 * ## Why this cannot be an `ORDER BY`
 *
 * The primary urgency key is the ORDER's `dispatchByAt`. `fulfillment_works`
 * does not carry it and, under ADR-053, the fulfilment context may not read
 * `orders` to get it — so the sort happens here, above both reads, over a page
 * the caller has already bounded. `FulfillmentWorkListFilter.orderBy` exists so
 * that the bounding at least truncates the safe end; see `BenchWorkService`.
 *
 * @module apps/api/src/bench/application
 */

/** The fields the comparator reads. Deliberately not the whole view. */
export interface BenchOrderingInput {
  readonly expeditedAt: Date | null;
  readonly dispatchByAt: Date | null;
  /** Stable final tiebreak, so two reads of an unchanged list agree exactly. */
  readonly workId: string;
}

/**
 * Most urgent first.
 *
 * 1. **Expedited before everything not expedited** (spec D22). Somebody made a
 *    decision that outranks the deadline; that is the entire point of the flag.
 * 2. **Among expedited parcels, first pushed first** — the instant is the
 *    tiebreak, which is why the flag is a timestamp rather than a boolean.
 * 3. **Then `dispatchByAt`, soonest first, with NULLS LAST.** An order carrying
 *    no deadline is not urgent, it is *unknown*, and sorting unknown to the top
 *    would push real, dated deadlines down the screen — the one direction that
 *    costs a dispatch.
 * 4. **Then the work id**, so the order is total and deterministic. Without it
 *    two parcels sharing a deadline could swap places between two polls and the
 *    list would appear to shuffle under a packer, which is exactly the loss of
 *    trust D22 warns about for a different reason.
 */
export function compareBenchWork(a: BenchOrderingInput, b: BenchOrderingInput): number {
  const aExpedited = a.expeditedAt !== null;
  const bExpedited = b.expeditedAt !== null;
  if (aExpedited !== bExpedited) return aExpedited ? -1 : 1;

  if (a.expeditedAt !== null && b.expeditedAt !== null) {
    const byPush = a.expeditedAt.getTime() - b.expeditedAt.getTime();
    if (byPush !== 0) return byPush;
  }

  // Nulls last, on both sides, before any comparison of two real dates.
  if (a.dispatchByAt === null && b.dispatchByAt !== null) return 1;
  if (a.dispatchByAt !== null && b.dispatchByAt === null) return -1;
  if (a.dispatchByAt !== null && b.dispatchByAt !== null) {
    const byDeadline = a.dispatchByAt.getTime() - b.dispatchByAt.getTime();
    if (byDeadline !== 0) return byDeadline;
  }

  return a.workId < b.workId ? -1 : a.workId > b.workId ? 1 : 0;
}
