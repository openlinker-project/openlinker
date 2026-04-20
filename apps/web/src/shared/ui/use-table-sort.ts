import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { OnChangeFn, SortingState } from '@tanstack/react-table';

interface UseTableSortResult {
  setSort: OnChangeFn<SortingState>;
  sort: SortingState;
}

/**
 * Syncs a single-column sort to the URL as `?sort=field:asc|desc`.
 *
 * Multi-column sort (a `SortingState` with more than one entry) is not
 * supported — only the first entry is serialized. Pages that need
 * multi-column sort should serialize their own param.
 */
export function useTableSort(defaultSort: SortingState = []): UseTableSortResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('sort');

  const sort = useMemo<SortingState>(() => parseSort(raw) ?? defaultSort, [raw, defaultSort]);

  const setSort = useCallback<OnChangeFn<SortingState>>(
    (updater) => {
      const next = typeof updater === 'function' ? updater(sort) : updater;
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next.length === 0) {
            params.delete('sort');
          } else {
            params.set('sort', encodeSort(next));
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams, sort],
  );

  return { sort, setSort };
}

function parseSort(raw: string | null): SortingState | null {
  if (!raw) return null;
  const [id, dir] = raw.split(':');
  if (!id) return null;
  return [{ id, desc: dir === 'desc' }];
}

function encodeSort(sorting: SortingState): string {
  const first = sorting[0];
  return `${first.id}:${first.desc ? 'desc' : 'asc'}`;
}
