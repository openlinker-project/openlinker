/**
 * useListingsListFilters (#4241)
 *
 * Every read and write of the Listings list's URL filter state, lifted out of
 * the page. Behaviour is the pre-#4241 inline code moved as it was: the same
 * params, the same "every filter change drops `offset`" rule, the same
 * replace-on-keystroke search.
 *
 * ONE `setSearchParams` call per user event: React Router builds the next
 * params from the CURRENT render's params, so two calls in one handler would
 * leave only the last applied.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import type { ListingsFilters } from '../api/listings.types';
import {
  DEFAULT_TAB,
  LIFECYCLE_TABS,
  isLifecycleTab,
  type LifecycleTab,
  type LifecycleTabDef,
} from '../lib/listings.list-config';

export const LISTINGS_SEARCH_DEBOUNCE_MS = 300;

export type ListingsMode = 'all' | 'queue';

export interface UseListingsListFiltersResult {
  urlConnectionId: string;
  sellingDeleted: boolean;
  shopBlocked: boolean;
  offset: number;
  tab: LifecycleTab;
  activeTabDef: LifecycleTabDef;
  /** The page's mode switch (`view` param): the listings table or the price-changes queue. */
  mode: ListingsMode;
  searchInput: string;
  debouncedSearch: string;
  /** The query filters: URL state plus the debounced search. */
  filters: ListingsFilters;
  hasFilters: boolean;
  setMode: (next: ListingsMode) => void;
  /** A discrete filter (channel, needs-a-look) written straight to the URL. */
  setParam: (key: 'connectionId' | 'staleSignal' | 'shopBlocked', value: string | null) => void;
  setSearch: (value: string) => void;
  setConnection: (value: string) => void;
  setTab: (next: LifecycleTab) => void;
  setOffset: (next: number) => void;
  showShopBlocked: (connectionId: string | null) => void;
  /** Resets search, channel, needs-a-look and the lifecycle tab. */
  clearFilters: () => void;
  /** Clears every filter but the tab (the pills' "clear all"). */
  clearPills: () => void;
}

export function useListingsListFilters(): UseListingsListFiltersResult {
  const [searchParams, setSearchParams] = useSearchParams();

  const urlSearch = searchParams.get('search') ?? '';
  const urlConnectionId = searchParams.get('connectionId') ?? '';
  // "Needs a look" filters (#4045/#4046): present-and-set is the only state.
  const sellingDeleted = searchParams.get('staleSignal') === 'selling';
  const shopBlocked = searchParams.get('shopBlocked') === 'true';
  // A malformed `?offset=` (hand-edited, or a stale bookmark) must fall back
  // to page 1, not become `NaN` and 400 the request (#2032 review thread 12).
  const rawOffset = Number(searchParams.get('offset') ?? '0');
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

  const rawTab = searchParams.get('tab');
  const tab: LifecycleTab = isLifecycleTab(rawTab) ? rawTab : DEFAULT_TAB;
  const activeTabDef = LIFECYCLE_TABS.find((def) => def.key === tab) ?? LIFECYCLE_TABS[0];

  const mode: ListingsMode = searchParams.get('view') === 'queue' ? 'queue' : 'all';

  const [searchInput, setSearchInput] = useState(urlSearch);
  const debouncedSearch = useDebouncedValue(searchInput, LISTINGS_SEARCH_DEBOUNCE_MS);

  const filters: ListingsFilters = {
    search: debouncedSearch || undefined,
    connectionId: urlConnectionId || undefined,
    lifecycle: activeTabDef.lifecycle,
    staleSignal: sellingDeleted ? 'selling' : undefined,
    shopBlocked: shopBlocked || undefined,
    // This page is the only caller that renders a tab bar (#2032 review
    // thread 3) - other callers of the query hook must not pay for the
    // aggregate's second full scan.
    includeLifecycleCounts: true,
  };

  const hasFilters = !!(debouncedSearch || urlConnectionId || sellingDeleted || shopBlocked);

  function setMode(next: ListingsMode): void {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === 'queue') params.set('view', 'queue');
      else params.delete('view');
      return params;
    });
  }

  function setParam(key: 'connectionId' | 'staleSignal' | 'shopBlocked', value: string | null): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete('offset');
      return next;
    });
  }

  function writeFilter(key: 'search' | 'connectionId', value: string): void {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        next.delete('offset');
        return next;
      },
      // Every keystroke calls this for `search` (#2032 review thread 12.3) -
      // typing "kurtka" must not leave six back-button steps to undo. A
      // discrete connectionId change stays a pushed entry.
      { replace: key === 'search' },
    );
  }

  function setSearch(value: string): void {
    setSearchInput(value);
    writeFilter('search', value);
  }

  function setConnection(value: string): void {
    writeFilter('connectionId', value);
  }

  /** A tab switch always lands on page 1 of the new bucket (#2029); the default tab is omitted from the URL. */
  function setTab(next: LifecycleTab): void {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === DEFAULT_TAB) params.delete('tab');
      else params.set('tab', next);
      params.delete('offset');
      return params;
    });
  }

  function setOffset(next: number): void {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === 0) params.delete('offset');
      else params.set('offset', String(next));
      return params;
    });
  }

  function showShopBlocked(connectionId: string | null): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('shopBlocked', 'true');
      if (connectionId) next.set('connectionId', connectionId);
      next.delete('offset');
      return next;
    });
  }

  function clearFilters(): void {
    setSearchInput('');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const key of ['search', 'connectionId', 'staleSignal', 'shopBlocked', 'offset', 'tab']) {
        next.delete(key);
      }
      // The platform-type filter is gone (#2025/#2030) but a bookmarked URL can
      // still carry it - strip it so the address bar cannot claim a scope the
      // table no longer applies.
      next.delete('platformType');
      return next;
    });
  }

  function clearPills(): void {
    setSearchInput('');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const key of ['search', 'connectionId', 'staleSignal', 'shopBlocked', 'offset']) next.delete(key);
      return next;
    });
  }

  return {
    urlConnectionId,
    sellingDeleted,
    shopBlocked,
    offset,
    tab,
    activeTabDef,
    mode,
    searchInput,
    debouncedSearch,
    filters,
    hasFilters,
    setMode,
    setParam,
    setSearch,
    setConnection,
    setTab,
    setOffset,
    showShopBlocked,
    clearFilters,
    clearPills,
  };
}
