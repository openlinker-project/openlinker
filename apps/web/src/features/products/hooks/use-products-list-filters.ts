/**
 * useProductsListFilters (#4241)
 *
 * Every read and write of the Products list's URL filter state, lifted out of
 * the page. Behaviour is the pre-#4241 inline code moved as it was: the same
 * params, the same widen-then-narrow guards, the same "every filter change drops
 * `offset`" rule, the same replace-on-keystroke search.
 *
 * One thing is new and it is the sort. The saved-views engine writes the sort as
 * one `sort=field:dir` param, where this page used two (`sort=field&dir=dir`).
 * The hook reads both spellings and writes the engine's, and rewrites a legacy
 * address in place on arrival, so an old link or bookmark keeps meaning what it
 * meant while the engine never reads `dir` out of a `sort` it cannot parse.
 *
 * ONE `setSearchParams` call per user event: React Router builds the next
 * params from the CURRENT render's params, so two calls in one handler would
 * leave only the last applied.
 *
 * @module apps/web/src/features/products/hooks
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import {
  ProductListSortDirValues,
  ProductStockFilterValues,
  type ProductFilters,
  type ProductListSortDir,
  type ProductListSortField,
  type ProductStockFilter,
} from '../api/products.types';
import { DEFAULT_PRODUCT_SORT, DEFAULT_PRODUCT_SORT_DIR, isProductSortField } from '../lib/products.list-config';

export const PRODUCTS_SEARCH_DEBOUNCE_MS = 300;

export type ProductBundleView = 'only' | 'exclude';
export type ProductTaxRateState = 'missing' | 'not-checked' | 'known';

/** Type-guard for the `stock` URL param (widen-then-narrow, orders pattern). */
function isStockFilter(value: string | null): value is ProductStockFilter {
  return value !== null && (ProductStockFilterValues as readonly string[]).includes(value);
}

/** Type-guard for a sort direction. */
function isSortDir(value: string | null | undefined): value is ProductListSortDir {
  return value !== null && value !== undefined && (ProductListSortDirValues as readonly string[]).includes(value);
}

/**
 * The sort an address means, in either spelling. `sort=field:dir` is the
 * engine's; `sort=field` with an optional `dir` is the one this page produced
 * before views, and a field with no direction takes its first-click default.
 */
function readSort(params: URLSearchParams): { field: ProductListSortField; dir: ProductListSortDir } {
  const raw = params.get('sort');
  const [head, tail] = (raw ?? '').split(':');
  const field = isProductSortField(head) ? head : DEFAULT_PRODUCT_SORT;
  const dir = isSortDir(tail) ? tail : isSortDir(params.get('dir')) ? (params.get('dir') as ProductListSortDir) : DEFAULT_PRODUCT_SORT_DIR[field];
  return { field, dir };
}

export interface UseProductsListFiltersResult {
  stock: ProductStockFilter | undefined;
  taxRateState: ProductTaxRateState | undefined;
  unlistedOnParam: string;
  unlistedOn: string[] | undefined;
  sourceConnectionId: string | undefined;
  hideFullyStale: boolean;
  bundleView: ProductBundleView | undefined;
  sortField: ProductListSortField;
  sortDir: ProductListSortDir;
  offset: number;
  searchInput: string;
  debouncedSearch: string;
  /** The query filters: URL state plus the debounced search. */
  filters: ProductFilters;
  anyFilterActive: boolean;
  handleSearchChange: (value: string) => void;
  /** Set/clear one filter param and reset paging. */
  setFilterParam: (key: string, value: string) => void;
  setOffset: (nextOffset: number) => void;
  /** Explicit sort write (the Sort menu). */
  setSort: (field: ProductListSortField, dir: ProductListSortDir) => void;
  /** Clears every filter; `keepStock` leaves the stock tab alone (the pills' Clear all). */
  clearFilters: (keepStock?: boolean) => void;
}

export function useProductsListFilters(): UseProductsListFiltersResult {
  const [searchParams, setSearchParams] = useSearchParams();

  const urlSearch = searchParams.get('search') ?? '';
  const rawStock = searchParams.get('stock');
  const stock = isStockFilter(rawStock) ? rawStock : undefined;
  const rawTaxRateState = searchParams.get('taxRateState');
  const taxRateState =
    rawTaxRateState === 'missing' || rawTaxRateState === 'not-checked' || rawTaxRateState === 'known'
      ? rawTaxRateState
      : undefined;
  const unlistedOnParam = searchParams.get('unlistedOn') ?? '';
  const unlistedOn = useMemo(
    () => (unlistedOnParam ? unlistedOnParam.split(',').filter(Boolean) : undefined),
    [unlistedOnParam],
  );
  const sourceConnectionId = searchParams.get('connectionId') ?? undefined;
  // #2447 - opt-in: hides only a product whose variants are ALL deleted at
  // the master (a "phantom" row, #1689). Default off so an install's
  // existing view is unchanged until the operator asks for it.
  const hideFullyStale = searchParams.get('hideStale') === '1';
  // #3624 - the "Bundles" view of the same list, URL-synced like every filter here.
  const rawBundles = searchParams.get('bundles');
  // `true` is the pre-"Without bundles" spelling of `only`; old links keep working.
  const bundleView: ProductBundleView | undefined =
    rawBundles === 'only' || rawBundles === 'true'
      ? 'only'
      : rawBundles === 'exclude'
        ? 'exclude'
        : undefined;
  const { field: sortField, dir: sortDir } = readSort(searchParams);
  const offset = Number(searchParams.get('offset') ?? '0');

  const [searchInput, setSearchInput] = useState(urlSearch);
  const debouncedSearch = useDebouncedValue(searchInput, PRODUCTS_SEARCH_DEBOUNCE_MS);

  const hasLegacySort = searchParams.has('dir') || (searchParams.has('sort') && !searchParams.get('sort')?.includes(':'));
  useEffect(() => {
    if (!hasLegacySort) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const sort = readSort(next);
        next.set('sort', `${sort.field}:${sort.dir}`);
        next.delete('dir');
        return next;
      },
      { replace: true },
    );
  }, [hasLegacySort, setSearchParams]);

  const filters: ProductFilters = {
    search: debouncedSearch || undefined,
    stock,
    taxRateState,
    unlistedOn,
    connectionId: sourceConnectionId,
    hideFullyStale: hideFullyStale || undefined,
    bundles: bundleView,
  };

  const setFilterParam = useCallback(
    (key: string, value: string): void => {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        if (value) {
          p.set(key, value);
        } else {
          p.delete(key);
        }
        p.delete('offset');
        return p;
      });
    },
    [setSearchParams],
  );

  const handleSearchChange = useCallback(
    (value: string): void => {
      setSearchInput(value);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value) {
          next.set('search', value);
        } else {
          next.delete('search');
        }
        next.delete('offset');
        return next;
      });
    },
    [setSearchParams],
  );

  const setOffset = useCallback(
    (nextOffset: number): void => {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        if (nextOffset === 0) {
          p.delete('offset');
        } else {
          p.set('offset', String(nextOffset));
        }
        return p;
      });
    },
    [setSearchParams],
  );

  const setSort = useCallback(
    (field: ProductListSortField, dir: ProductListSortDir): void => {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        p.set('sort', `${field}:${dir}`);
        p.delete('dir');
        p.delete('offset');
        return p;
      });
    },
    [setSearchParams],
  );

  const anyFilterActive = Boolean(
    debouncedSearch ||
      stock ||
      unlistedOnParam ||
      sourceConnectionId ||
      hideFullyStale ||
      taxRateState ||
      bundleView !== undefined,
  );

  const clearFilters = useCallback(
    (keepStock = false): void => {
      setSearchInput('');
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('search');
        if (!keepStock) next.delete('stock');
        next.delete('unlistedOn');
        next.delete('connectionId');
        next.delete('hideStale');
        next.delete('bundles');
        next.delete('taxRateState');
        next.delete('offset');
        return next;
      });
    },
    [setSearchParams],
  );

  return {
    stock,
    taxRateState,
    unlistedOnParam,
    unlistedOn,
    sourceConnectionId,
    hideFullyStale,
    bundleView,
    sortField,
    sortDir,
    offset,
    searchInput,
    debouncedSearch,
    filters,
    anyFilterActive,
    handleSearchChange,
    setFilterParam,
    setOffset,
    setSort,
    clearFilters,
  };
}
