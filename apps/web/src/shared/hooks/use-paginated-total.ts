/**
 * Two-stage paginated total (#2945)
 *
 * A paged read stops after its `LIMIT`; the `COUNT` beside it cannot stop at
 * all. On a list whose filter no plain index serves - a jsonb containment, an
 * `ILIKE`, a function-wrapped column - the count therefore scans the table
 * however small the page is, and the page waits on it. #2843 measured 142 ms
 * of a 149 ms `/orders` request going to the count alone at a million rows.
 *
 * So the list renders from the paged query, and the total arrives as a SECOND
 * stage. This hook is that second stage, built once because getting it wrong
 * is easy in four specific ways, every one of which turns an improvement into
 * a regression:
 *
 * 1. **Debounce, or this is worse than what it replaces.** A total re-fetched
 *    on every keystroke of a filter input is a request storm against the most
 *    expensive query in the system.
 * 2. **Never render a superseded total.** A slow answer for the filter the
 *    operator has LEFT is worse than no number, because it looks authoritative.
 *    Two mechanisms guard it: the query is keyed on the filters (so TanStack
 *    can only ever hand back the current key's data, and a late response lands
 *    in a different cache entry), and while the debounce is still settling the
 *    hook reports `null` rather than the previous key's answer. Note that
 *    `placeholderData: keepPreviousData` is deliberately NOT used - it is the
 *    exact mechanism that would surface the previous filter's total.
 * 3. **Delay the loader, so small installs never see it.** At ten thousand
 *    orders the count returns in about 11 ms; a spinner that appears and
 *    vanishes inside that window is a flicker, and a flicker is worse than no
 *    state change at all.
 * 4. **A failed count is not zero.** On error the total stays `null` and the
 *    caller keeps its placeholder. Rendering `0` would state that nothing
 *    matched, which is a positive claim from an absent value.
 *
 * And one thing that makes the change invisible where there was no problem at
 * all: {@link inferTotalFromPage}. A page that came back SHORT already carries
 * its own exact total, so the count is never requested and the loader never
 * has anything to delay.
 *
 * @module shared/hooks
 * @see shared/ui/list-pagination for the presentational half
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDebouncedValue } from './use-debounced-value';

/**
 * How long a filter change must settle before the total is re-fetched.
 *
 * Longer than a list's own search debounce on purpose: the rows are the cheap
 * query and should move first, and the total is the one worth waiting a beat
 * longer to avoid asking for twice.
 */
export const TOTAL_DEBOUNCE_MS = 400;

/**
 * How long the count must be in flight before a loading affordance appears.
 *
 * 175 ms sits inside the 150-200 ms band the epic specifies. Below it an
 * operator on a small install sees an instant page - exactly what they see
 * today - and only an install large enough to have the problem ever reaches
 * the two-stage behaviour.
 */
export const TOTAL_LOADER_DELAY_MS = 175;

/**
 * What the second stage is doing right now.
 *
 * - `known`       the total is available (fetched, or inferred from a short page)
 * - `settling`    a filter changed and the debounce has not elapsed
 * - `pending`     the count is in flight
 * - `unavailable` the count failed, or was not asked for
 */
export type PaginatedTotalState = 'known' | 'settling' | 'pending' | 'unavailable';

export interface PaginatedTotalResult {
  /** The exact total, or `null` when it is not known. NEVER `0` as a stand-in. */
  total: number | null;
  state: PaginatedTotalState;
  /**
   * Whether to render a loading affordance. `false` for the whole delay window
   * even while `state === 'pending'`, so a fast count never flickers.
   */
  showLoader: boolean;
}

export interface UsePaginatedTotalOptions {
  /**
   * The total's own query key. MUST be derived from the FILTERS ONLY - never
   * from `limit`/`offset`. That is what lets paging through a result set reuse
   * one cached count instead of recomputing the expensive aggregate per page.
   */
  queryKey: readonly unknown[];
  /** Fetches the total. Forward `signal` so a superseded request is aborted. */
  queryFn: (context: { signal: AbortSignal }) => Promise<number>;
  /**
   * An exact total the caller already knows, typically from
   * {@link inferTotalFromPage}. When non-null the count is NOT requested.
   */
  knownTotal?: number | null;
  /** Set false while the rows query has not resolved, or the list is hidden. */
  enabled?: boolean;
  debounceMs?: number;
  loaderDelayMs?: number;
}

/**
 * The exact total a page implies, or `null` when it implies none.
 *
 * A page shorter than the limit it asked for is the end of the result set, so
 * `offset + rowCount` is the total exactly - the same inference TypeORM's own
 * `lazyCount` makes server-side. Deriving it here costs nothing and means a
 * list that fits on one page never issues a count at all.
 *
 * Two cases return `null` rather than guessing:
 * - a FULL page, where more rows may or may not follow;
 * - an EMPTY page at a non-zero offset, where the operator has paged past the
 *   end and the total is anywhere between 0 and `offset`.
 *
 * **Precondition**: `rowCount` must be the number of rows the query matched,
 * not a client-side subset of them. Every list this serves returns its rows
 * straight from `LIMIT`/`OFFSET`; a caller that filters the page after
 * fetching it must pass `knownTotal: null` instead.
 */
export function inferTotalFromPage(page: {
  rowCount: number;
  limit: number;
  offset: number;
}): number | null {
  const { rowCount, limit, offset } = page;
  if (rowCount >= limit) return null;
  if (rowCount === 0 && offset > 0) return null;
  return offset + rowCount;
}

export function usePaginatedTotal(options: UsePaginatedTotalOptions): PaginatedTotalResult {
  const {
    queryKey,
    queryFn,
    knownTotal = null,
    enabled = true,
    debounceMs = TOTAL_DEBOUNCE_MS,
    loaderDelayMs = TOTAL_LOADER_DELAY_MS,
  } = options;

  // Serialised so the debounce compares by VALUE. A caller building its key
  // inline produces a new array identity every render, which would reset the
  // timer forever and mean the count never fires.
  const keyHash = JSON.stringify(queryKey);
  const settledKeyHash = useDebouncedValue(keyHash, debounceMs);
  const settled = settledKeyHash === keyHash;

  // The page already implies an exact total, so there is nothing to fetch and
  // nothing to wait for. This is what keeps the change invisible on an install
  // whose lists fit inside one page.
  const inferred = knownTotal !== null && knownTotal !== undefined;

  const query = useQuery({
    // The caller's own key, verbatim - never a hash of it. TanStack compares
    // keys structurally, so this both dedupes correctly and stays reachable by
    // a caller's `invalidateQueries({ queryKey: ['orders'] })` after a
    // mutation; an opaque hash would silently drop out of that prefix match.
    //
    // A response for an abandoned key lands in THAT key's cache entry and can
    // never be read here, which is what makes "a slow earlier response
    // overwrites a fast later one" unrepresentable rather than merely
    // unlikely. `enabled` holds the fetch until the debounce settles, and
    // until it does the hook reports `null` rather than the previous key's
    // answer - the key here is the current one, so there is no previous
    // answer to read.
    queryKey,
    queryFn: ({ signal }) => queryFn({ signal }),
    enabled: enabled && settled && !inferred,
    // No `placeholderData: keepPreviousData`, deliberately - see the header.
    // `retry` and `staleTime` are inherited from the app's query defaults so
    // the count follows the same read policy as every other list read rather
    // than carrying a second, divergent one.
  });

  let state: PaginatedTotalState;
  let total: number | null;
  if (inferred) {
    state = 'known';
    total = knownTotal;
  } else if (!enabled) {
    state = 'unavailable';
    total = null;
  } else if (!settled) {
    state = 'settling';
    total = null;
  } else if (query.isSuccess) {
    state = 'known';
    total = query.data;
  } else if (query.isError) {
    // A failed count leaves the placeholder standing. Never `0`.
    state = 'unavailable';
    total = null;
  } else {
    state = 'pending';
    total = null;
  }

  // Armed by `pending` ALONE, never by `settling`. The window being protected
  // is the COUNT's own duration - at ten thousand orders that is about 11 ms.
  // Including the debounce would arm the timer the moment a key is pressed, so
  // a small install would show a ~236 ms loader flash on every keystroke burst:
  // precisely the flicker the delay exists to prevent, introduced by the delay.
  const showLoader = useDelayedFlag(state === 'pending', loaderDelayMs);

  return { total, state, showLoader };
}

/**
 * `true` only once `active` has been continuously true for `delayMs`.
 *
 * Falls back to `false` the instant `active` does, so a count that resolves
 * inside the window never renders a loading state at all.
 */
function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return;
    }
    const timer = setTimeout(() => {
      if (activeRef.current) setElapsed(true);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [active, delayMs]);

  return active && elapsed;
}
