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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { setPartsIn } from '../lib/column-parts';
import { normalizeView } from '../lib/normalize-view';
import { defaultColumnIds, reconcileView } from '../lib/reconcile-view';
import type { ViewChangeKind, ViewDefinition, ViewSort } from '../lib/saved-view.types';
import type { ListRegistry } from '../lib/view-registry.types';
import { diffViews, isDirty } from '../lib/view-diff';
import { resolveNonViewParams } from '../lib/view-query';

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

const draftStorageKey = (pageKey: string): string => `ol.saved-views.${pageKey}.draft.v1`;

interface StoredDraft {
  columns: string[];
  parts: Record<string, string[]>;
}

/** The operator's own columns on a built-in-only list, reconciled so a retired column cannot come back. */
function readStoredDraft<Row>(registry: ListRegistry<Row>): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(draftStorageKey(registry.pageKey));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { columns, parts } = parsed as { columns?: unknown; parts?: unknown };
    if (!Array.isArray(columns) || !columns.every((id): id is string => typeof id === 'string')) return null;
    const partMap: Record<string, string[]> = {};
    if (typeof parts === 'object' && parts !== null) {
      for (const [key, value] of Object.entries(parts)) {
        if (Array.isArray(value) && value.every((id): id is string => typeof id === 'string')) partMap[key] = value;
      }
    }
    const { definition } = reconcileView({ v: 1, query: '', sort: null, columns, parts: partMap }, registry);
    return { columns: definition.columns, parts: definition.parts };
  } catch {
    return null;
  }
}

function writeStoredDraft(pageKey: string, draft: StoredDraft | null): void {
  try {
    if (draft) window.localStorage.setItem(draftStorageKey(pageKey), JSON.stringify(draft));
    else window.localStorage.removeItem(draftStorageKey(pageKey));
  } catch {
    // Not persisting a column choice is acceptable; the in-memory state still applies.
  }
}

export function useViewDraft<Row>(
  registry: ListRegistry<Row>,
  /** The view the list started from, already reconciled and normalised. */
  saved: ViewDefinition,
  url: { query: string; sort: ViewSort | null },
  /** Keep column and field choices per list in localStorage (a list with built-in views only has nowhere else to put them). */
  persist = false,
): ViewDraft {
  const [initial] = useState(() => (persist ? readStoredDraft(registry) : null));
  const [columns, setColumnsState] = useState<string[]>(initial?.columns ?? saved.columns);
  const [parts, setPartsState] = useState<Record<string, string[]>>(initial?.parts ?? saved.parts);
  // Only the operator's own edits are written: following a view (rebase) must not overwrite their choice.
  const touched = useRef(false);
  useEffect(() => {
    if (persist && touched.current) writeStoredDraft(registry.pageKey, { columns, parts });
  }, [persist, registry.pageKey, columns, parts]);

  const current = useMemo<ViewDefinition>(
    () => normalizeView(registry, { v: 1, query: url.query, sort: url.sort, columns, parts }),
    [registry, url.query, url.sort, columns, parts],
  );

  const changes = useMemo(() => diffViews(current, saved, resolveNonViewParams(registry)), [current, saved, registry]);
  const dirty = useMemo(() => isDirty(current, saved, resolveNonViewParams(registry)), [current, saved, registry]);

  const setPartsFor = useCallback(
    (columnId: string, ids: string[]) => {
      const column = registry.columns.find((candidate) => candidate.id === columnId);
      if (!column) return;
      touched.current = true;
      setPartsState((previous) => setPartsIn(column, { parts: previous }, ids).parts);
    },
    [registry.columns],
  );

  const setColumns = useCallback((ids: string[]) => {
    touched.current = true;
    setColumnsState(ids);
  }, []);

  const rebase = useCallback((definition: ViewDefinition) => {
    touched.current = false;
    setColumnsState(definition.columns);
    setPartsState(definition.parts);
  }, []);

  const restoreColumnDefaults = useCallback(() => {
    touched.current = false;
    if (persist) writeStoredDraft(registry.pageKey, null);
    setColumnsState(defaultColumnIds(registry));
    setPartsState({});
  }, [registry, persist]);

  return { current, changes, dirty, setColumns, setPartsFor, rebase, restoreColumnDefaults };
}
