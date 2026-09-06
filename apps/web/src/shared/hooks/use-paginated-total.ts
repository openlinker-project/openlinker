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
 *    The guard is that the query is keyed on the filters, so TanStack can only
 *    ever hand back the CURRENT key's data and a late response for an abandoned
 *    one lands in a different cache entry. That is also why a cached answer is
 *    safe to show while the debounce is still settling: it belongs to the
 *    filters on screen, not to the ones being left. `placeholderData:
 *    keepPreviousData` is deliberately NOT used - it is the one mechanism that
 *    would surface the previous filter's total, and it is the reason a caller
 *    whose ROWS query keeps a placeholder must not pass that page as
 *    `knownTotal` (see {@link inferTotalFromPage}'s precondition).
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
import { useEffect, useState } from 'react';
import { hashKey, useQuery } from '@tanstack/react-query';
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
 * - `idle`        not asked for - typically the rows have not landed yet
 * - `unavailable` the count was asked for and FAILED
 *
 * `idle` and `unavailable` are kept apart because a surface renders them
 * differently: both leave the placeholder standing, but only one may say the
 * count could not be loaded. Collapsing them would make an ordinary refetch
 * report a failure that did not happen.
 */
export type PaginatedTotalState = 'known' | 'settling' | 'pending' | 'idle' | 'unavailable';

export interface PaginatedTotalResult<TData = PaginatedTotalPayload> {
  /** The exact total, or `null` when it is not known. NEVER `0` as a stand-in. */
  total: number | null;
  state: PaginatedTotalState;
  /**
   * Whether to render a loading affordance. `false` for the whole delay window
   * even while `state === 'pending'`, so a fast count never flickers.
   */
  showLoader: boolean;
  /**
   * The count response as fetched, for a route whose `/count` answers with more
   * than the number - `/listings` returns the tab-bar buckets alongside it.
   * `undefined` until it lands, and while an inferred total made the request
   * unnecessary.
   */
  data: TData | undefined;
}

/** The minimum every `/count` route answers with. */
export interface PaginatedTotalPayload {
  total: number;
}

export interface UsePaginatedTotalOptions<TData = PaginatedTotalPayload> {
  /**
   * The total's own query key. MUST be derived from the FILTERS ONLY - never
   * from `limit`/`offset`. That is what lets paging through a result set reuse
   * one cached count instead of recomputing the expensive aggregate per page.
   */
  queryKey: readonly unknown[];
  /** Fetches the count response. Forward `signal` so a superseded request is aborted. */
  queryFn: (context: { signal: AbortSignal }) => Promise<TData>;
  /**
   * Pulls the number out of that response.
   *
   * Explicit rather than assumed, so a route answering with more than the total
   * has one obvious place to say which field is the total - and so two
   * observers of the same query key can never disagree about the cached shape.
   *
   * Returning `null` reports the total as UNAVAILABLE. That is for a response
   * this caller cannot honestly read a number out of - `/listings/count`
   * answering without its lifecycle buckets while a tab is selected, say, where
   * the payload's own `total` is the un-narrowed sum and therefore the wrong
   * number. Reporting unknown is the only safe answer; substituting a number
   * from a different question is the failure this whole mechanism exists to
   * prevent, one layer in.
   *
   * Applied at READ time, in the render body - never handed to TanStack's
   * `select`. That is what lets a selector close over state the query key
   * deliberately omits (again `/listings`, whose key carries no `lifecycle`)
   * and re-derive from the same cached response when that state changes.
   * Moving it into `useQuery({ select })` would capture it at fetch time and
   * silently freeze the stale value.
   */
  selectTotal: (data: TData) => number | null;
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
 * {@link inferTotalFromPage} for a page that may not have loaded yet.
 *
 * An absent page implies NOTHING - in particular not `0`. Calling the raw
 * helper with `rowCount: 0` before the rows land would infer an exact zero
 * from a page nobody has seen.
 */
export function inferTotalFromLoadedPage(
  page: { items: readonly unknown[]; limit: number; offset: number } | undefined
): number | null {
  if (!page) return null;
  return inferTotalFromPage({
    rowCount: page.items.length,
    limit: page.limit,
    offset: page.offset,
  });
}

/**
 * The exact total a page implies, or `null` when it implies none.
 *
 * A page shorter than the limit it asked for is the end of the result set, so
 * `offset + rowCount` is the total exactly. Deriving it here costs nothing and
 * means a list that fits on one page never issues a count at all - which is
 * worth more than it sounds, because the server does NOT make this inference
 * for us: typeorm@0.3.17's `getManyAndCount` runs its count unconditionally.
 *
 * Two cases return `null` rather than guessing:
 * - a FULL page, where more rows may or may not follow;
 * - an EMPTY page at a non-zero offset, where the operator has paged past the
 *   end and the total is anywhere between 0 and `offset`.
 *
 * **Precondition**: `rowCount` must be the number of rows the query matched,
 * not a client-side subset of them, and the page must be the one CURRENTLY
 * displayed for the current filters. A list whose rows query keeps the previous
 * page alive (`placeholderData: keepPreviousData`) must therefore not infer
 * from that placeholder - it describes a filter the operator has left, and
 * `offset + rowCount` would state its size as the new filter's. A caller that
 * filters the page after fetching it, or that holds a placeholder, passes
 * `knownTotal: null` instead.
 *
 * A non-finite input returns `null` rather than propagating. `offset + rowCount`
 * on an absent field is `NaN`, and `NaN` is a WORSE stand-in than the `0` this
 * mechanism already refuses: it reads as "of NaN", and every comparison against
 * it is false, so the pager's Next silently dies.
 */
export function inferTotalFromPage(page: {
  rowCount: number;
  limit: number;
  offset: number;
}): number | null {
  const { rowCount, limit, offset } = page;
  if (!Number.isFinite(rowCount) || !Number.isFinite(limit) || !Number.isFinite(offset)) {
    return null;
  }
  if (rowCount >= limit) return null;
  if (rowCount === 0 && offset > 0) return null;
  return offset + rowCount;
}

/**
 * Render a total, or the `N+` placeholder when it is not known yet (#2947).
 *
 * `atLeast` is the floor the rows already prove - `offset + rowCount`. It is
 * never `0` as a stand-in for "unknown": the rows on screen are evidence for
 * that many, and claiming none matched would be a positive statement from an
 * absent value.
 *
 * `atLeast` may itself be `null`, meaning the page has not loaded and there is
 * no floor to state. That renders an em-dash rather than `0+`, which would be a
 * floor computed from nothing - the deep-link case (`?offset=100` before a row
 * exists) that #2957 review S2 turned up on both consuming surfaces.
 *
 * One function so every surface showing the same total spells the placeholder
 * the same way - `<ListPagination>` and any per-page "N results" line alike.
 */
export function formatPaginatedTotal(total: number | null, atLeast: number | null): string {
  if (total !== null) return total.toLocaleString();
  return atLeast !== null ? `${atLeast.toLocaleString()}+` : '—';
}

export function usePaginatedTotal<TData = PaginatedTotalPayload>(
  options: UsePaginatedTotalOptions<TData>
): PaginatedTotalResult<TData> {
  const {
    queryKey,
    queryFn,
    selectTotal,
    knownTotal = null,
    enabled = true,
    debounceMs = TOTAL_DEBOUNCE_MS,
    loaderDelayMs = TOTAL_LOADER_DELAY_MS,
  } = options;

  // Serialised so the debounce compares by VALUE. A caller building its key
  // inline produces a new array identity every render, which would reset the
  // timer forever and mean the count never fires.
  //
  // TanStack's own `hashKey`, not `JSON.stringify` (#2957 review, S7). It sorts
  // object keys, so a caller that builds its filters conditionally
  // (`{ ...base, ...(x ? { a } : {}) }`) cannot produce a hash that flips
  // between renders while TanStack sees one key - which would leave `settled`
  // permanently false and the count permanently unfetched, silently, behind a
  // cached value that keeps the UI looking correct.
  const keyHash = hashKey(queryKey);
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

  // A cached answer for the CURRENT key, if there is one. `queryKey` is always
  // the current filters' key, so TanStack can only ever hand back this filter's
  // data - which is what makes it safe to read even while the fetch is disabled
  // or the debounce is settling. Checked before those two branches on purpose:
  // the key carries no offset, so paging a result set lands here every time,
  // and blanking a number already in hand would be a flicker for nothing.
  const cached = query.isSuccess ? selectTotal(query.data) : null;

  let state: PaginatedTotalState;
  let total: number | null;
  if (inferred) {
    state = 'known';
    total = knownTotal;
  } else if (cached !== null) {
    state = 'known';
    total = cached;
  } else if (!enabled) {
    state = 'idle';
    total = null;
  } else if (!settled) {
    state = 'settling';
    total = null;
  } else if (query.isError) {
    // A failed count leaves the placeholder standing. Never `0`.
    state = 'unavailable';
    total = null;
  } else if (query.isSuccess) {
    // Fetched, but `selectTotal` declined to read a number out of it - see its
    // docblock. Unknown, not zero, and not the payload's own number.
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

  return { total, state, showLoader, data: query.data };
}

/**
 * `true` only once `active` has been continuously true for `delayMs`.
 *
 * Falls back to `false` the instant `active` does, so a count that resolves
 * inside the window never renders a loading state at all.
 */
function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);

  // No ref guard inside the timeout: the cleanup below clears the timer
  // whenever `active` changes, so the callback cannot fire while inactive. A
  // ref would also have to be written during render, which a render body must
  // not do - the listings page deleted one for exactly that reason.
  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return;
    }
    const timer = setTimeout(() => {
      setElapsed(true);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [active, delayMs]);

  return active && elapsed;
}
