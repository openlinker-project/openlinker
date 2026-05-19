/**
 * Bounded-concurrency Promise helper for bulk operations
 *
 * Caps in-flight promises at `limit` while preserving result order. Used by
 * the bulk-wizard auto-match step to avoid saturating Allegro's
 * `/sale/matching-categories` endpoint at 50+ parallel requests (`useResolveCategoryQuery`
 * has `retry: false`, so a 429 burst would silently flip rows to ❌).
 *
 * No external dependency — 20 lines, `Promise.allSettled` semantics.
 *
 * @module apps/web/src/features/listings/lib
 */

/**
 * Run `mapper(item)` over every item with at most `limit` promises in
 * flight at a time. Returns settled results in the order of `items`.
 */
export async function pAllLimit<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  if (limit < 1) throw new Error(`pAllLimit: limit must be >= 1, got ${String(limit)}`);
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      const item = items[i];
      // `noUncheckedIndexedAccess` is off in this project, so `items[i]` is
      // narrowed to T directly — but we still guard for completeness.
      if (item === undefined) continue;
      try {
        const value = await mapper(item, i);
        results[i] = { status: 'fulfilled', value };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };

  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, worker);
  await Promise.all(workers);
  return results;
}

/** Default concurrency for bulk-wizard EAN→category resolves. */
export const BULK_RESOLVE_CONCURRENCY = 8;
