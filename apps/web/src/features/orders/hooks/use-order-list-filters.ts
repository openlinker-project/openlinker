/**
 * useOrderListFilters (#3507)
 *
 * Every read and write of the orders list's URL filter state, lifted out of the
 * page so the page is layout. Behaviour is the pre-#3507 inline code moved 1:1:
 * the same params, the same present-only toggles, the same `demo_orders_filtered`
 * analytics events, the same "every filter change drops `offset`" rule.
 *
 * ONE `setSearchParams` call per user event, always. React Router builds the
 * next params from the CURRENT render's params, so two calls in one handler
 * both start from the same base and the second supersedes the first — a
 * "Clear all" that cleared one param per call would leave all but the last
 * one applied (#2148). Every writer below therefore takes a single mutator.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import { captureDemoEvent } from '../../demo';
import {
  OrderSortDirectionValues,
  OrderSortValues,
  type OrderFilters,
  type OrderHealthValue,
  type OrderHealthSummaryFilters,
  type OrderSortDirection,
  type OrderSortValue,
} from '../api/orders.types';
import {
  ORDER_FILTER_DESCRIPTORS,
  ORDER_FILTER_PARAMS,
  ORDER_TOGGLE_FILTER_VALUES,
  activeOrderFilterKeys,
  parseOrderListFilterState,
  toOrderQueryFilters,
  type NarrowingOrderFilterKey,
  type OrderListFilterState,
  type OrderToggleFilterKey,
} from '../lib/order-filter-descriptors';
import type { OrderLifecyclePhaseValue } from '../lib/order-lifecycle-phase.types';

/** #3529 — same debounce window as `/customers` and `/products`. */
export const ORDER_SEARCH_DEBOUNCE_MS = 300;

/** "Breaching soon" window — orders due within this horizon (or already overdue). */
const BREACHING_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Triage default ordering — soonest ship-by first (NULLs last), server-backed. */
export const DEFAULT_ORDER_SORT: OrderSortValue = 'dispatchBy';

/**
 * First-click direction per sort key (#944): the operator-intuitive default
 * when a column is newly selected. Re-clicking the active column flips it.
 */
export const DEFAULT_ORDER_SORT_DIR: Record<OrderSortValue, OrderSortDirection> = {
  dispatchBy: 'asc',
  createdAt: 'desc',
  customer: 'asc',
  items: 'desc',
  status: 'asc',
  total: 'desc',
  fulfillment: 'asc',
  payment: 'asc',
};

function isOrderSort(value: string | null): value is OrderSortValue {
  return value !== null && (OrderSortValues as readonly string[]).includes(value);
}

function isOrderDir(value: string | null): value is OrderSortDirection {
  return value !== null && (OrderSortDirectionValues as readonly string[]).includes(value);
}

/** `{ tag }` one tag, `{ untagged: true }` "No tags", `null` any tag. */
export type OrderTagFilterValue = { tag: string } | { untagged: true } | null;

export interface UseOrderListFiltersResult {
  state: OrderListFilterState;
  /** The query filters: URL state + debounced search + sort. */
  filters: OrderFilters;
  sort: OrderSortValue;
  dir: OrderSortDirection;
  applySort: (key: OrderSortValue) => void;
  /** Controlled search box value (every keystroke). */
  searchInput: string;
  /** What the query actually used (debounced). */
  debouncedSearch: string;
  setSearch: (value: string) => void;
  offset: number;
  setOffset: (next: number) => void;
  /** Set or clear one filter by key; `null`/`''` removes the param. */
  setFilter: (key: NarrowingOrderFilterKey, value: string | null) => void;
  /** Flip a present-only toggle. */
  toggle: (key: OrderToggleFilterKey) => void;
  setHealth: (next: OrderHealthValue | null) => void;
  /** Select a phase; selecting the active one clears it. */
  togglePhase: (next: OrderLifecyclePhaseValue) => void;
  setTagFilter: (value: OrderTagFilterValue) => void;
  /** Remove several keys in ONE write (a chip that folds two params). */
  clear: (keys: readonly NarrowingOrderFilterKey[]) => void;
  clearAll: () => void;
  activeKeys: NarrowingOrderFilterKey[];
  /** Any narrowing filter at all, including search / health / phase (#2148). */
  hasActiveFilters: boolean;
  /** Source + date scope the KPI summaries share (never `health`, which would self-filter). */
  summaryScope: OrderHealthSummaryFilters;
}

export function useOrderListFilters(): UseOrderListFiltersResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo(() => parseOrderListFilterState(searchParams), [searchParams]);

  const rawSort = searchParams.get('sort');
  const sort = isOrderSort(rawSort) ? rawSort : DEFAULT_ORDER_SORT;
  const rawDir = searchParams.get('dir');
  // Direction defaults to the active key's first-click default until a header
  // click pins an explicit one (#944).
  const dir: OrderSortDirection = isOrderDir(rawDir) ? rawDir : DEFAULT_ORDER_SORT_DIR[sort];
  const offset = Number(searchParams.get('offset') ?? '0');

  // `searchInput` is the CONTROLLED value (every keystroke) and also lands in
  // the URL immediately so the box is shareable; the request only fires once
  // `debouncedSearch` catches up (#3527/#3529).
  const [searchInput, setSearchInput] = useState(state.search);
  const debouncedSearch = useDebouncedValue(searchInput, ORDER_SEARCH_DEBOUNCE_MS);
  // Keeps the box in sync when the URL changes from elsewhere — Clear all,
  // back/forward, a bookmark. A no-op on the keystrokes `setSearch` causes.
  useEffect(() => {
    setSearchInput(state.search);
  }, [state.search]);

  // Stable per toggle (not recomputed each render) so the query key doesn't churn.
  const dueBefore = useMemo(
    () => (state.breaching ? new Date(Date.now() + BREACHING_WINDOW_MS).toISOString() : undefined),
    [state.breaching],
  );

  const filters: OrderFilters = useMemo(
    () => ({ ...toOrderQueryFilters(state, { dueBefore, search: debouncedSearch }), sort, dir }),
    [state, dueBefore, debouncedSearch, sort, dir],
  );

  const write = useCallback(
    (mutate: (p: URLSearchParams) => void, keepOffset = false): void => {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        mutate(p);
        if (!keepOffset) p.delete('offset');
        return p;
      });
    },
    [setSearchParams],
  );

  const setFilter = useCallback(
    (key: NarrowingOrderFilterKey, value: string | null): void => {
      const { param, analyticsName } = ORDER_FILTER_DESCRIPTORS[key];
      captureDemoEvent('demo_orders_filtered', { filter: analyticsName, value: value || 'all' });
      write((p) => {
        if (value) p.set(param, value);
        else p.delete(param);
      });
    },
    [write],
  );

  const toggle = useCallback(
    (key: OrderToggleFilterKey): void => {
      const { param, analyticsName, isActive } = ORDER_FILTER_DESCRIPTORS[key];
      const on = isActive(state);
      captureDemoEvent('demo_orders_filtered', { filter: analyticsName, value: String(!on) });
      write((p) => {
        if (on) p.delete(param);
        else p.set(param, ORDER_TOGGLE_FILTER_VALUES[key]);
      });
    },
    [state, write],
  );

  const setHealth = useCallback(
    (next: OrderHealthValue | null): void => {
      captureDemoEvent('demo_orders_filtered', { filter: 'health', value: next ?? 'all' });
      write((p) => {
        if (next) p.set('health', next);
        else p.delete('health');
      });
    },
    [write],
  );

  const togglePhase = useCallback(
    (next: OrderLifecyclePhaseValue): void => {
      const clearing = state.phase === next;
      captureDemoEvent('demo_orders_filtered', { filter: 'phase', value: clearing ? 'all' : next });
      write((p) => {
        if (clearing) p.delete('phase');
        else p.set('phase', next);
      });
    },
    [state.phase, write],
  );

  const setTagFilter = useCallback(
    (value: OrderTagFilterValue): void => {
      captureDemoEvent('demo_orders_filtered', {
        filter: 'tag',
        value: value === null ? 'all' : 'untagged' in value ? 'untagged' : 'tag',
      });
      write((p) => {
        p.delete('tag');
        p.delete('untagged');
        if (value && 'untagged' in value) p.set('untagged', 'true');
        else if (value) p.set('tag', value.tag);
      });
    },
    [write],
  );

  const clear = useCallback(
    (keys: readonly NarrowingOrderFilterKey[]): void => {
      if (keys.includes('search')) setSearchInput('');
      write((p) => {
        for (const key of keys) p.delete(ORDER_FILTER_DESCRIPTORS[key].param);
      });
    },
    [write],
  );

  const clearAll = useCallback((): void => {
    setSearchInput('');
    write((p) => {
      for (const param of ORDER_FILTER_PARAMS) p.delete(param);
    });
  }, [write]);

  const setSearch = useCallback(
    (value: string): void => {
      setSearchInput(value);
      write((p) => {
        if (value) p.set('search', value);
        else p.delete('search');
      });
    },
    [write],
  );

  const setOffset = useCallback(
    (next: number): void => {
      write((p) => {
        if (next === 0) p.delete('offset');
        else p.set('offset', String(next));
      }, true);
    },
    [write],
  );

  const applySort = useCallback(
    (key: OrderSortValue): void => {
      const nextDir: OrderSortDirection =
        key === sort ? (dir === 'asc' ? 'desc' : 'asc') : DEFAULT_ORDER_SORT_DIR[key];
      write((p) => {
        p.set('sort', key);
        p.set('dir', nextDir);
      });
    },
    [sort, dir, write],
  );

  const activeKeys = useMemo(() => activeOrderFilterKeys(state), [state]);
  const hasActiveFilters = ORDER_FILTER_PARAMS.some((param) => searchParams.get(param) !== null);

  const summaryScope = useMemo(
    () => ({
      sourceConnectionId: filters.sourceConnectionId,
      createdFrom: filters.createdFrom,
      createdTo: filters.createdTo,
    }),
    [filters.sourceConnectionId, filters.createdFrom, filters.createdTo],
  );

  return {
    state,
    filters,
    sort,
    dir,
    applySort,
    searchInput,
    debouncedSearch,
    setSearch,
    offset,
    setOffset,
    setFilter,
    toggle,
    setHealth,
    togglePhase,
    setTagFilter,
    clear,
    clearAll,
    activeKeys,
    hasActiveFilters,
    summaryScope,
  };
}
