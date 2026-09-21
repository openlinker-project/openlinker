/**
 * Sales-Document Page Merge (#3306)
 *
 * Pure merge of two independently keyset-paginated sources (invoice records,
 * fiscal-registration records) into one newest-first page, capped at `limit`.
 *
 * Never OFFSET, and never a SQL UNION — see
 * `docs/plans/mockups/sales-documents.html` §06 for why: two sources paged by
 * OFFSET and merged in application code silently skip or duplicate rows the
 * moment a new document lands between two page fetches, which on a
 * financial-audit-adjacent list is a correctness bug, not a performance
 * nuance. Keyset pagination on each side avoids that because a cursor names a
 * ROW, never a row COUNT.
 *
 * The tricky part is the OUTGOING cursor, not the merge itself: a source
 * whose fetched batch was only partially consumed this page must resume from
 * the last CONSUMED row of that source, not the last FETCHED one, or the
 * unconsumed tail would be skipped on the next call.
 *
 * @module libs/core/src/orders/domain
 */

/** One row from either source, reduced to what ordering needs. */
export interface MergeCandidate<TSourceId extends string> {
  readonly source: TSourceId;
  readonly createdAt: Date;
  readonly id: string;
}

/** One source's already-fetched page, plus what its OWN repository reported as the next cursor. */
export interface SourcePage<TSourceId extends string, TItem extends MergeCandidate<TSourceId>> {
  readonly items: readonly TItem[];
  /** `null` = this source is exhausted (fewer than the requested limit came back). */
  readonly ownNextCursor: { createdAt: Date; id: string } | null;
}

/** A source's outgoing cursor position: `null` = exhausted, `undefined` = "start of table" (unchanged from an un-fetched-yet first page), otherwise a concrete row to resume after. */
export type SourceCursorState = { createdAt: Date; id: string } | null | undefined;

export interface MergedPage<TSourceId extends string, TItem extends MergeCandidate<TSourceId>> {
  readonly items: TItem[];
  /**
   * Per source, `null` means "never fetch this source again for this walk."
   * `undefined` means "this source's fetched batch was entirely OLDER than
   * the merged cutoff and none of it was consumed — resume from wherever it
   * was fetched FROM" (which for a true first page IS `undefined`, i.e.
   * fetch it from the start again; coercing that to `null` would wrongly
   * mark a source with real, unconsumed rows as exhausted). Anything else is
   * the last row of this source actually consumed into `items`.
   */
  readonly nextCursor: Record<TSourceId, SourceCursorState>;
}

/**
 * Merge two sources' pages, newest-first (`createdAt` DESC, `id` DESC as the
 * deterministic tiebreak — the same tiebreak `groupRankedRecords` already
 * uses), truncated to `limit`.
 */
export function mergeSalesDocumentPages<
  TSourceId extends string,
  TItem extends MergeCandidate<TSourceId>,
>(
  pages: Record<TSourceId, SourcePage<TSourceId, TItem>>,
  incomingCursor: Record<TSourceId, SourceCursorState>,
  limit: number,
): MergedPage<TSourceId, TItem> {
  const sourceIds = Object.keys(pages) as TSourceId[];

  const all = sourceIds.flatMap((sourceId) => pages[sourceId].items);
  all.sort(
    (left, right) =>
      right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id),
  );
  const items = all.slice(0, limit);

  const nextCursor = {} as Record<TSourceId, SourceCursorState>;
  for (const sourceId of sourceIds) {
    const sourcePage = pages[sourceId];
    if (sourcePage.items.length === 0) {
      // Nothing came back for this source at all — truly exhausted.
      nextCursor[sourceId] = null;
      continue;
    }

    const lastConsumed = [...items].reverse().find((item) => item.source === sourceId);
    if (lastConsumed) {
      nextCursor[sourceId] = { createdAt: lastConsumed.createdAt, id: lastConsumed.id };
    } else {
      // This source's fetched batch contributed NOTHING to the truncated page
      // (every one of its rows was newer than the cutoff — the other source
      // alone filled the page). Resume from wherever it was fetched FROM,
      // UNCHANGED (including `undefined`, "start of table") — never coerced
      // to `null`, which would wrongly mark a source with real, unconsumed
      // rows waiting as exhausted.
      nextCursor[sourceId] = incomingCursor[sourceId];
    }
  }

  return { items, nextCursor };
}
