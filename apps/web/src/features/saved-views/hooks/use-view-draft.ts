/**
 * useViewDraft
 *
 * The list as it is on screen versus the view it started from. Filters and sort
 * come from the URL (the single source of state); columns and the fields of
 * stacked columns are the draft's own, because they have no place in an address.
 * Everything else here is derived: the current definition, what changed, whether
 * it is dirty.
 *
 * @module apps/web/src/features/saved-views/hooks
 */
import { useCallback, useMemo, useState } from 'react';
import { setPartsIn } from '../lib/column-parts';
import { normalizeView } from '../lib/normalize-view';
import { defaultColumnIds } from '../lib/reconcile-view';
import type { ViewChangeKind, ViewDefinition, ViewSort } from '../lib/saved-view.types';
import type { ListRegistry } from '../lib/view-registry.types';
import { diffViews, isDirty } from '../lib/view-diff';

export interface ViewDraft {
  /** The list as it is now: URL filters and sort, draft columns and fields. */
  current: ViewDefinition;
  changes: ViewChangeKind[];
  dirty: boolean;
  setColumns: (ids: string[]) => void;
  setPartsFor: (columnId: string, ids: string[]) => void;
  /** Throws the draft's columns and fields away for those of `definition`. */
  rebase: (definition: ViewDefinition) => void;
  /** Columns and fields back to the page defaults. Sort lives in the URL and is reset by the caller. */
  restoreColumnDefaults: () => void;
}

export function useViewDraft<Row>(
  registry: ListRegistry<Row>,
  /** The view the list started from, already reconciled and normalised. */
  saved: ViewDefinition,
  url: { query: string; sort: ViewSort | null },
): ViewDraft {
  const [columns, setColumnsState] = useState<string[]>(saved.columns);
  const [parts, setPartsState] = useState<Record<string, string[]>>(saved.parts);

  const current = useMemo<ViewDefinition>(
    () => normalizeView(registry, { v: 1, query: url.query, sort: url.sort, columns, parts }),
    [registry, url.query, url.sort, columns, parts],
  );

  const changes = useMemo(() => diffViews(current, saved, registry.nonViewParams), [current, saved, registry.nonViewParams]);
  const dirty = useMemo(() => isDirty(current, saved, registry.nonViewParams), [current, saved, registry.nonViewParams]);

  const setPartsFor = useCallback(
    (columnId: string, ids: string[]) => {
      const column = registry.columns.find((candidate) => candidate.id === columnId);
      if (!column) return;
      setPartsState((previous) => setPartsIn(column, { parts: previous }, ids).parts);
    },
    [registry.columns],
  );

  const rebase = useCallback((definition: ViewDefinition) => {
    setColumnsState(definition.columns);
    setPartsState(definition.parts);
  }, []);

  const restoreColumnDefaults = useCallback(() => {
    setColumnsState(defaultColumnIds(registry));
    setPartsState({});
  }, [registry]);

  return { current, changes, dirty, setColumns: setColumnsState, setPartsFor, rebase, restoreColumnDefaults };
}
