/**
 * Saved View Types
 *
 * The shape of a view definition and of the views a list page shows. A view
 * is a shortcut to a list state (filters, sort, columns, fields of stacked
 * columns); it never stores search text, page, density or theme, which belong
 * to the moment rather than to a view.
 *
 * @module apps/web/src/features/saved-views/lib
 */

export const VIEW_DEFINITION_VERSION = 1;

export type SortDirection = 'asc' | 'desc';

export interface ViewSort {
  key: string;
  dir: SortDirection;
}

export interface ViewDefinition {
  v: typeof VIEW_DEFINITION_VERSION;
  /** Serialized filter query string without offset or cursor, no leading `?`. */
  query: string;
  /** `null` means "the page's default sort". */
  sort: ViewSort | null;
  /** Visible column ids, in order. The locked first column is never listed. */
  columns: string[];
  /** Per stacked column: the visible field ids in order. Only deviations from the column default are stored. */
  parts: Record<string, string[]>;
  pageSize?: number;
}

/** Scopes a server view can have. */
export type StoredViewScope = 'personal' | 'shared';
/** Scopes the UI shows; `system` views live in code and are read-only. */
export type ViewScope = StoredViewScope | 'system';

/** One row of `GET /saved-views`. */
export interface SavedView {
  id: string;
  pageKey: string;
  name: string;
  scope: StoredViewScope;
  definition: ViewDefinition;
  revision: number;
  isDefault: boolean;
  ownerUserId: string | null;
  /** The server flagged the stored definition as written for an older schema. */
  stale?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSavedViewInput {
  pageKey: string;
  name: string;
  scope: StoredViewScope;
  definition: ViewDefinition;
}

export interface UpdateSavedViewInput {
  name?: string;
  definition?: ViewDefinition;
  expectedRevision: number;
}

export interface SetDefaultViewInput {
  pageKey: string;
  /** `null` clears the personal default. */
  viewId: string | null;
}

/** A view as the strip, the menu and the draft hook handle it: system and stored views alike. */
export interface ListView {
  id: string;
  name: string;
  scope: ViewScope;
  definition: ViewDefinition;
  /** Counter shown on the tab. Only system views carry one. */
  count?: number;
  tone?: 'error' | 'warning';
  /** Shown beside the name of a shared view. */
  ownerLabel?: string;
  revision?: number;
  stale?: boolean;
  /** The signed-in user's default for this list (stored views only). */
  isDefault?: boolean;
}

export type ViewChangeKind = 'filters' | 'sort' | 'columns' | 'fields';

export type ViewIssue =
  | { kind: 'unknown-column'; columnId: string }
  | { kind: 'unknown-part'; columnId: string; partIds: string[] }
  | { kind: 'unknown-filter'; key: string }
  | { kind: 'invalid-filter-value'; key: string; value: string }
  | { kind: 'unknown-sort'; key: string };

export interface ReconcileResult {
  definition: ViewDefinition;
  issues: ViewIssue[];
}
