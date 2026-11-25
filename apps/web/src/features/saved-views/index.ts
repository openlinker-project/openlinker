/**
 * Saved Views - Feature Public Surface
 *
 * Cross-boundary callers import only from here (#4241). A list page declares a
 * `ListRegistry`, calls `useListView`, and renders the presentational
 * components with the props it returns.
 *
 * Registry identity: `useListView` memoizes everything it derives on the
 * identity of the registry object. A page whose cells close over query data
 * (connection names, formatters) must build the registry in `useMemo` keyed on
 * that data, or every render recomputes the views and the strip flickers.
 * `resolveNonViewParams` also caches per registry object.
 *
 * @module apps/web/src/features/saved-views
 */
export { createSavedViewsApi } from './api/saved-views.api';
export type { SavedViewsApi } from './api/saved-views.api';
export { useListView } from './hooks/use-list-view';
export type { ListViewState, UseListViewOptions } from './hooks/use-list-view';
export { useSavedViews } from './hooks/use-saved-views';
export type { UseSavedViewsResult } from './hooks/use-saved-views';
export { useViewDraft } from './hooks/use-view-draft';
export type { ViewDraft } from './hooks/use-view-draft';
export { useViewUrlState } from './hooks/use-view-url-state';
export type { ViewUrlState } from './hooks/use-view-url-state';
export { ColumnsPanel } from './components/columns-panel';
export type { ColumnsPanelProps } from './components/columns-panel';
export { EditedBar } from './components/edited-bar';
export type { EditedBarProps } from './components/edited-bar';
export { RepairBanner } from './components/repair-banner';
export type { RepairBannerProps } from './components/repair-banner';
export { ViewDialogs } from './components/view-dialogs';
export type { SaveSummary, SubmitOutcome, ViewDialogsProps, ViewDialogState } from './components/view-dialogs';
export { ViewsBar } from './components/views-bar';
export type { ViewsBarProps } from './components/views-bar';
export { coerceViewDefinition } from './lib/coerce-view-definition';
export { partIds, partsOf, reorder, setPartsIn, withColumnLayout } from './lib/column-parts';
export { decodeStoredQuery, forStorage, normalizeView } from './lib/normalize-view';
export { defaultColumnIds, definitionFromSystemView, effectiveSort, reconcileView } from './lib/reconcile-view';
export type {
  CreateSavedViewInput,
  ListView,
  ReconcileResult,
  SavedView,
  SetDefaultViewInput,
  SortDirection,
  StoredViewScope,
  UpdateSavedViewInput,
  ViewChangeKind,
  ViewDefinition,
  ViewIssue,
  ViewScope,
  ViewSort,
} from './lib/saved-view.types';
export { VIEW_DEFINITION_VERSION } from './lib/saved-view.types';
export { toDataTableColumns } from './lib/to-data-table-columns';
export { diffViews, isDirty } from './lib/view-diff';
export { canonicalQuery, DEFAULT_NON_VIEW_PARAMS, encodeSort, filterEntries, parseSort, readSort, resolveNonViewParams, writeSort } from './lib/view-query';
export type {
  ColumnDef,
  FilterDef,
  ListRegistry,
  LockedColumnDef,
  PartDef,
  SortCodec,
  SortOption,
  StoredQueryCodec,
  SystemViewDef,
  ViewHeaderContext,
} from './lib/view-registry.types';
