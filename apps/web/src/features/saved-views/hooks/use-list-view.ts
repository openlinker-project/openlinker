/**
 * useListView
 *
 * The one hook a list page calls. It composes server state (`useSavedViews`),
 * URL state (`useViewUrlState`) and the edited-versus-saved diff
 * (`useViewDraft`), and hands back ready-made props for the presentational
 * components, so a page declares its registry and renders:
 *
 *   const view = useListView({ registry, pageTitle });
 *   <ViewsBar {...view.viewsBar} /> ... <ColumnsPanel {...view.columnsPanel} />
 *   <DataTable columns={view.toColumns()} ... />
 *
 * It owns NO rows. Fetching stays with the page's own TanStack Query hook,
 * keyed on the filters the URL carries; this hook only decides what the list
 * should look like and writes the address.
 *
 * Load order: a deep link (an address that already carries filters or a sort)
 * wins over any default view; otherwise the personal default, then the shared
 * default, then the first built-in view is applied to the address.
 *
 * @module apps/web/src/features/saved-views/hooks
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { useIsAdmin } from '../../../shared/auth/use-permission';
import { interpolate } from '../../../shared/i18n/interpolate';
import { useMessages } from '../../../shared/i18n/use-messages';
import type { DataTableColumn } from '../../../shared/ui/data-table';
import { useToast } from '../../../shared/ui/toast-provider';
import type { ColumnsPanelProps } from '../components/columns-panel';
import type { EditedBarProps } from '../components/edited-bar';
import type { RepairBannerProps } from '../components/repair-banner';
import type { ViewDialogsProps, ViewDialogState } from '../components/view-dialogs';
import type { ViewsBarProps } from '../components/views-bar';
import { coerceViewDefinition } from '../lib/coerce-view-definition';
import { decodeStoredQuery, forStorage, normalizeView } from '../lib/normalize-view';
import { definitionFromSystemView, reconcileView } from '../lib/reconcile-view';
import type {
  ListView,
  SavedView,
  ViewDefinition,
  ViewIssue,
  ViewSort,
} from '../lib/saved-view.types';
import { toDataTableColumns } from '../lib/to-data-table-columns';
import { filterEntries, resolveNonViewParams } from '../lib/view-query';
import { uniqueCopyName } from '../lib/view-name';
import type { ListRegistry } from '../lib/view-registry.types';
import { MAX_PINNED_VIEWS, usePinnedViews } from './use-pinned-views';
import { isNameTakenError, isRevisionConflict, useSavedViews } from './use-saved-views';
import { useViewDraft } from './use-view-draft';
import { useViewUrlState } from './use-view-url-state';

export interface UseListViewOptions<Row> {
  registry: ListRegistry<Row>;
  /** The list's name, used in toasts and the "open by default" checkbox. */
  pageTitle: string;
  /** Counters for the built-in tabs, keyed by system view id. Absent means no number. */
  counts?: Record<string, number | undefined>;
  /** Words a filter query for the save summary. Defaults to `key: value`. */
  describeFilters?: (query: string) => string[];
}

export interface ListViewState<Row> {
  /** The saved views finished loading (or the list has none to load). */
  isReady: boolean;
  activeView: ListView;
  /** The list as it is on screen. */
  current: ViewDefinition;
  sort: ViewSort;
  /** Draft changes against the active view. */
  isEdited: boolean;
  /** Columns for `DataTable`, in view order, with headers wired to sorting. */
  toColumns: () => DataTableColumn<Row>[];
  setSort: (key: string) => void;
  viewsBar: ViewsBarProps;
  /** `null` while the list matches its view (and always on a list with built-in views only). */
  editedBar: EditedBarProps | null;
  /** `null` when the active view has nothing missing, or the operator dismissed it. */
  repairBanner: RepairBannerProps | null;
  columnsPanel: ColumnsPanelProps<Row>;
  dialogs: ViewDialogsProps;
}

type Snapshot = { viewId: string; definition: ViewDefinition };

export function useListView<Row>(options: UseListViewOptions<Row>): ListViewState<Row> {
  const { registry, pageTitle, counts } = options;
  const copy = useMessages('saved-views');
  const { showToast } = useToast();
  const isAdmin = useIsAdmin();
  const customViews = registry.customViews !== false;
  const sortable = registry.sorts.length > 0;
  const url = useViewUrlState(resolveNonViewParams(registry), {
    viewParam: registry.viewParam,
    sortable,
    sortCodec: registry.sortCodec,
  });
  const server = useSavedViews(registry.pageKey, customViews);

  const systemViews = useMemo<ListView[]>(
    () =>
      registry.systemViews.map((view) => ({
        id: view.id,
        name: view.name,
        scope: 'system',
        definition: definitionFromSystemView(registry, view),
        count: counts?.[view.id],
        tone: view.tone,
      })),
    [registry, counts],
  );
  const storedViews = useMemo<ListView[]>(
    () =>
      customViews
        ? server.views.map((view: SavedView) => ({
            id: view.id,
            name: view.name,
            scope: view.scope,
            definition: decodeStoredQuery(registry, coerceViewDefinition(view.definition)),
            revision: view.revision,
            stale: view.stale,
            isDefault: view.isDefault,
          }))
        : [],
    [customViews, server.views, registry],
  );
  const views = useMemo(
    () => [
      ...systemViews,
      ...storedViews.filter((view) => view.scope === 'shared'),
      ...storedViews.filter((view) => view.scope === 'personal'),
    ],
    [systemViews, storedViews],
  );

  const defaultView = useMemo(
    () =>
      storedViews.find((view) => view.scope === 'personal' && view.isDefault) ??
      storedViews.find((view) => view.scope === 'shared' && view.isDefault) ??
      (systemViews[0]),
    [storedViews, systemViews],
  );

  const activeView = useMemo<ListView>(() => {
    const named = url.viewId ? views.find((view) => view.id === url.viewId) : undefined;
    if (named) return named;
    if (url.hasState) {
      // A deep link names no view: show it against the built-in view that says the same filters, else against "All".
      return (
        views.find((view) => normalizeView(registry, view.definition).query === url.query) ??
        (systemViews[0])
      );
    }
    return defaultView;
  }, [views, url.viewId, url.hasState, url.query, registry, systemViews, defaultView]);

  const reconciled = useMemo(
    () => reconcileView(activeView.definition, registry),
    [activeView.definition, registry],
  );
  const saved = useMemo(() => normalizeView(registry, reconciled.definition), [registry, reconciled.definition]);
  const draft = useViewDraft(registry, saved, { query: url.query, sort: url.sort }, !customViews);

  // ---- load: deep link wins, otherwise apply the default view to the address ----
  const loaded = !customViews || !server.isLoading;
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || !loaded) return;
    applied.current = true;
    if (!url.hasState) {
      url.apply({ query: saved.query, sort: saved.sort }, activeView.id, { replace: true });
    } else if (url.viewId && !views.some((view) => view.id === url.viewId)) {
      url.apply({ query: url.query, sort: url.sort }, null, { replace: true });
    }
  }, [loaded, url, saved, activeView.id, views]);

  // ---- columns and fields follow the active view when it changes ----
  const pending = useRef<ViewDefinition | null>(null);
  const rebasedFor = useRef(activeView.id);
  const { rebase } = draft;
  useEffect(() => {
    if (rebasedFor.current === activeView.id) return;
    rebasedFor.current = activeView.id;
    rebase(pending.current ?? saved);
    pending.current = null;
  }, [activeView.id, saved, rebase]);

  const isSavedView = activeView.scope !== 'system';
  const canEdit = activeView.scope === 'personal' || (activeView.scope === 'shared' && isAdmin);

  // ---- strip ----
  const lockedIds = useMemo(
    () => registry.lockedViewIds ?? systemViews.slice(0, 2).map((view) => view.id),
    [registry.lockedViewIds, systemViews],
  );
  const { pinned, setPinned } = usePinnedViews(
    registry.pageKey,
    registry.pinned ?? systemViews.slice(0, MAX_PINNED_VIEWS).map((view) => view.id),
  );
  const pinnedIds = useMemo(() => pinned.filter((id) => views.some((view) => view.id === id)), [pinned, views]);
  const tabs = useMemo(() => {
    const ids = pinnedIds.includes(activeView.id) ? pinnedIds : pinnedIds.concat(activeView.id);
    return ids.map((id) => views.find((view) => view.id === id)).filter((view): view is ListView => !!view);
  }, [pinnedIds, activeView.id, views]);

  const notify = useCallback(
    (description: string, action?: { label: string; onClick: () => void }) =>
      showToast({ tone: 'success', description, action, durationMs: action ? 8000 : 5000 }),
    [showToast],
  );
  const fail = useCallback(
    (error: unknown) => {
      // A revision conflict already told the operator, with a reload action.
      if (isRevisionConflict(error)) return;
      showToast({ tone: 'error', description: describeApiError(error) });
    },
    [showToast],
  );

  const [dialog, setDialog] = useState<ViewDialogState | null>(null);
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

  const restore = useCallback(
    (snapshot: Snapshot) => {
      pending.current = snapshot.definition;
      url.apply({ query: snapshot.definition.query, sort: snapshot.definition.sort }, snapshot.viewId);
      // Same view: the active id does not change, so there is no effect to rebase through.
      if (snapshot.viewId === activeView.id) rebase(snapshot.definition);
    },
    [url, activeView.id, rebase],
  );

  const select = useCallback(
    (id: string) => {
      const target = views.find((view) => view.id === id);
      if (!target || id === activeView.id) return;
      const snapshot: Snapshot = { viewId: activeView.id, definition: draft.current };
      const lost = draft.dirty && isSavedView;
      const next = normalizeView(registry, reconcileView(target.definition, registry).definition);
      pending.current = next;
      url.apply({ query: next.query, sort: next.sort }, id);
      if (lost) {
        notify(interpolate(copy.toasts.discarded, { name: activeView.name }), {
          label: copy.toasts.undo,
          onClick: () => restore(snapshot),
        });
      }
    },
    [views, activeView, draft, isSavedView, registry, url, notify, copy.toasts, restore],
  );

  const resetDraft = useCallback(() => {
    pending.current = saved;
    url.apply({ query: saved.query, sort: saved.sort }, activeView.id, { replace: true });
    rebase(saved);
  }, [saved, url, activeView.id, rebase]);

  const saveChanges = useCallback(async () => {
    if (!isSavedView || !canEdit) return;
    try {
      await server.update(activeView, { definition: forStorage(registry, draft.current), expectedRevision: activeView.revision ?? 0 });
      notify(interpolate(copy.toasts.savedChanges, { name: activeView.name }));
    } catch (error) {
      fail(error);
    }
  }, [isSavedView, canEdit, server, activeView, draft, registry, notify, copy.toasts, fail]);

  const autoPin = useCallback(
    (id: string): { list: string[]; note: string } => {
      let list = pinnedIds.slice();
      let note = '';
      if (list.length >= MAX_PINNED_VIEWS) {
        const out = list.find(
          (pin) =>
            !lockedIds.includes(pin) &&
            pin !== activeView.id &&
            views.some((view) => view.id === pin && view.scope !== 'system'),
        );
        if (out) {
          list = list.filter((pin) => pin !== out);
          const outName = views.find((view) => view.id === out)?.name ?? '';
          note = ` ${interpolate(copy.toasts.replacedPin, { name: outName })}`;
        }
      }
      if (list.length < MAX_PINNED_VIEWS) list.push(id);
      return { list, note };
    },
    [pinnedIds, lockedIds, activeView.id, views, copy.toasts],
  );

  const create = useCallback<ViewDialogsProps['onCreate']>(
    async ({ name, scope, asDefault }) => {
      try {
        const created = await server.create({ name, scope, definition: forStorage(registry, draft.current) });
        if (asDefault && scope === 'personal') await server.setDefault(created.id);
        const pin = autoPin(created.id);
        setPinned(pin.list);
        // The new view starts out exactly as the list looks now.
        pending.current = draft.current;
        url.apply({ query: draft.current.query, sort: draft.current.sort }, created.id);
        setDialog(null);
        notify(
          interpolate(scope === 'shared' ? copy.toasts.savedViewShared : copy.toasts.savedView, { name }) + pin.note,
        );
        return 'ok';
      } catch (error) {
        if (isNameTakenError(error)) return 'taken';
        fail(error);
        return 'error';
      }
    },
    [server, draft, registry, autoPin, setPinned, url, notify, copy.toasts, fail],
  );

  const rename = useCallback<ViewDialogsProps['onRename']>(
    async (view, name) => {
      try {
        await server.update(view, { name, expectedRevision: view.revision ?? 0 });
        setDialog(null);
        notify(interpolate(copy.toasts.renamed, { name }));
        return 'ok';
      } catch (error) {
        if (isNameTakenError(error)) return 'taken';
        fail(error);
        return 'error';
      }
    },
    [server, notify, copy.toasts, fail],
  );

  const remove = useCallback(
    async (view: ListView) => {
      try {
        await server.remove(view.id);
        setDialog(null);
        setPinned(pinnedIds.filter((id) => id !== view.id));
        const wasDefault = view.isDefault === true;
        if (view.id === activeView.id) {
          const fallback = wasDefault ? (systemViews[0]) : defaultView;
          const next = normalizeView(registry, reconcileView(fallback.definition, registry).definition);
          pending.current = next;
          url.apply({ query: next.query, sort: next.sort }, fallback.id, { replace: true });
        }
        notify(
          interpolate(copy.toasts.deleted, { name: view.name }) +
            (wasDefault
              ? ` ${interpolate(copy.toasts.deletedDefault, { page: pageTitle, fallback: (systemViews[0]).name })}`
              : ''),
        );
      } catch (error) {
        setDialog(null);
        fail(error);
      }
    },
    [server, setPinned, pinnedIds, activeView.id, systemViews, defaultView, registry, url, notify, copy.toasts, pageTitle, fail],
  );

  const duplicate = useCallback(
    async (id: string) => {
      const source = views.find((view) => view.id === id);
      if (!source) return;
      const fromActive = id === activeView.id;
      const definition = fromActive
        ? draft.current
        : normalizeView(registry, reconcileView(source.definition, registry).definition);
      const snapshot: Snapshot = { viewId: activeView.id, definition: draft.current };
      const lost = draft.dirty && isSavedView && !fromActive;
      try {
        const created = await server.create({
          name: uniqueCopyName(source.name, views, copy.viewsBar.copyWord),
          scope: 'personal',
          definition: forStorage(registry, definition),
        });
        pending.current = definition;
        url.apply({ query: definition.query, sort: definition.sort }, created.id);
        notify(fromActive && draft.dirty ? copy.toasts.copiedWithChanges : copy.toasts.copied, lost
          ? { label: copy.toasts.undo, onClick: () => restore(snapshot) }
          : undefined);
      } catch (error) {
        fail(error);
      }
    },
    [views, activeView, draft, registry, isSavedView, server, url, notify, copy, restore, fail],
  );

  const setDefault = useCallback(
    async (id: string) => {
      const target = views.find((view) => view.id === id);
      if (!target || target.scope === 'system') return;
      try {
        // Choosing the current default again clears it.
        await server.setDefault(target.isDefault ? null : id);
        if (!target.isDefault) notify(interpolate(copy.toasts.defaultSet, { page: pageTitle, name: target.name }));
      } catch (error) {
        fail(error);
      }
    },
    [views, server, notify, copy.toasts, pageTitle, fail],
  );

  const togglePin = useCallback(
    (id: string) => {
      if (lockedIds.includes(id) && pinnedIds.includes(id)) {
        notify(copy.toasts.lockedPin);
        return;
      }
      if (pinnedIds.includes(id)) setPinned(pinnedIds.filter((pin) => pin !== id));
      else if (pinnedIds.length >= MAX_PINNED_VIEWS) {
        notify(interpolate(copy.toasts.pinFull, { max: MAX_PINNED_VIEWS }));
      } else setPinned(pinnedIds.concat(id));
    },
    [lockedIds, pinnedIds, setPinned, notify, copy.toasts],
  );

  const setSortKey = useCallback(
    (key: string) => {
      const sort = draft.current.sort as ViewSort;
      const option = registry.sorts.find((candidate) => candidate.key === key);
      url.setSort(
        sort.key === key
          ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
          : { key, dir: option?.dir ?? 'desc' },
      );
    },
    [draft, registry.sorts, url],
  );

  const sort = draft.current.sort as ViewSort;
  const toColumns = useCallback(
    () =>
      toDataTableColumns(registry, draft.current, {
        sort,
        onSort: setSortKey,
        sortLabel: (label, active, dir) =>
          active
            ? interpolate(dir === 'asc' ? copy.sortField.ascending : copy.sortField.descending, { label })
            : interpolate(copy.sortField.sortable, { label }),
      }),
    [registry, draft, sort, setSortKey, copy.sortField],
  );

  const issueLines = useMemo(
    () => reconciled.issues.map((issue) => describeIssue(issue, registry, copy)),
    [reconciled.issues, registry, copy],
  );

  const describeFilters = options.describeFilters;
  const summary = useMemo(
    () => ({
      filters:
        describeFilters?.(draft.current.query) ??
        filterEntries(draft.current.query, resolveNonViewParams(registry)).map(([key, value]) => `${key}: ${value}`),
      sortLabel: sortLabelOf(registry, sort),
      columnCount: draft.current.columns.length + 1,
    }),
    [describeFilters, draft, registry, sort],
  );

  return {
    isReady: loaded,
    activeView,
    current: draft.current,
    sort,
    isEdited: draft.dirty,
    toColumns,
    setSort: setSortKey,
    viewsBar: {
      tabs,
      activeId: activeView.id,
      views,
      pinnedIds,
      lockedIds,
      defaultId: defaultView.id,
      isAdmin,
      customViews,
      onSelect: select,
      onPin: togglePin,
      onSetDefault: (id) => void setDefault(id),
      onDuplicate: (id) => void duplicate(id),
      onRename: (id) => {
        const view = views.find((candidate) => candidate.id === id);
        if (view) setDialog({ mode: 'rename', view });
      },
      onDelete: (id) => {
        const view = views.find((candidate) => candidate.id === id);
        if (view) setDialog({ mode: 'delete', view });
      },
      onNew: () => setDialog({ mode: 'create' }),
    },
    editedBar:
      customViews && draft.dirty
        ? {
            changes: draft.changes,
            isSavedView,
            canEdit,
            onReset: resetDraft,
            onSaveChanges: () => void saveChanges(),
            onSaveAsNew: () => setDialog({ mode: 'create' }),
          }
        : null,
    repairBanner:
      issueLines.length > 0 && !dismissed[activeView.id]
        ? {
            issues: issueLines,
            canEdit: isSavedView && canEdit,
            onFix: () => void saveChanges(),
            onSaveAsMine: () => setDialog({ mode: 'create' }),
            onDismiss: () => setDismissed((previous) => ({ ...previous, [activeView.id]: true })),
          }
        : null,
    columnsPanel: {
      columns: registry.columns,
      locked: registry.locked,
      visibleIds: draft.current.columns,
      parts: draft.current.parts,
      sort,
      sortOptions: registry.sorts,
      sortFallbackLabel: sortLabelOf(registry, sort),
      showSavedForYouHint: !customViews,
      onSortChange: url.setSort,
      onColumnsChange: draft.setColumns,
      onPartsChange: draft.setPartsFor,
      onRestoreDefaults: () => {
        draft.restoreColumnDefaults();
        if (sortable) url.setSort(registry.defaultSort);
      },
    },
    dialogs: {
      dialog,
      views,
      isAdmin,
      pageTitle,
      summary,
      activeHasUnsavedChanges: draft.dirty,
      activeId: activeView.id,
      onClose: () => setDialog(null),
      onCreate: create,
      onRename: rename,
      onDelete: (view) => void remove(view),
    },
  };
}

function sortLabelOf<Row>(registry: ListRegistry<Row>, sort: ViewSort): string {
  const known = registry.sorts.find((option) => option.key === sort.key && option.dir === sort.dir);
  return known ? known.label : `${sort.key}, ${sort.dir === 'asc' ? 'ascending' : 'descending'}`;
}

function describeIssue<Row>(
  issue: ViewIssue,
  registry: ListRegistry<Row>,
  copy: ReturnType<typeof useMessages<'saved-views'>>,
): string {
  const issues = copy.repair.issues;
  switch (issue.kind) {
    case 'unknown-column':
      return interpolate(issues.unknownColumn, { name: issue.columnId });
    case 'unknown-part':
      return interpolate(issues.unknownPart, {
        column: registry.columns.find((column) => column.id === issue.columnId)?.label ?? issue.columnId,
      });
    case 'unknown-filter':
      return interpolate(issues.unknownFilter, { name: issue.key });
    case 'invalid-filter-value':
      return interpolate(issues.invalidFilterValue, { name: issue.key, value: issue.value });
    case 'unknown-sort':
      return interpolate(issues.unknownSort, { fallback: sortLabelOf(registry, registry.defaultSort) });
  }
}

