/**
 * List Registry Types
 *
 * What a list page declares once: its columns (with the fields of stacked
 * columns), the filters a view may carry, the sorts it offers and its system
 * views. The engine reads this; it never learns about a particular page.
 *
 * @module apps/web/src/features/saved-views/lib
 */
import type { ReactNode } from 'react';
import type { ViewSort } from './saved-view.types';

/** What a header needs to draw and drive its sort buttons. */
export interface ViewHeaderContext {
  sort: ViewSort;
  onSort: (key: string) => void;
  /** Accessible name of a sort button, with its current state. */
  sortLabel: (label: string, active: boolean, dir: 'asc' | 'desc') => string;
}

/** One field of a stacked column (e.g. Total / Payment / Placed inside one cell). */
export interface PartDef<Row> {
  id: string;
  label: string;
  /** Sort key this field can sort by, shown as a button in the header. */
  sort?: string;
  /** Short header label for the field's sort button. Fields without one get no header button. */
  headerLabel?: string;
  render: (row: Row) => ReactNode;
}

export interface ColumnDef<Row> {
  id: string;
  /** Name in the Columns panel. */
  label: string;
  /** Second line in the Columns panel for a column without `parts`. */
  description?: string;
  defaultVisible: boolean;
  align?: 'left' | 'right';
  width?: string;
  /** Header text for a single-field column, and the fallback for a stacked one with no sortable field visible. */
  header?: ReactNode;
  /** Sort key of a single-field column. */
  sortKey?: string;
  render?: (row: Row) => ReactNode;
  parts?: PartDef<Row>[];
}

/** The always-visible first column (identity). Cannot be hidden or moved. */
export interface LockedColumnDef<Row> {
  id: string;
  label: string;
  description?: string;
  header: ReactNode | ((context: ViewHeaderContext) => ReactNode);
  /** Sort keys this column's header controls. */
  sortKeys?: string[];
  render: (row: Row) => ReactNode;
  width?: string;
}

export interface FilterDef {
  key: string;
  /** Returns true when the raw URL value is one this filter still accepts. */
  parse?: (raw: string) => boolean;
}

export interface SortOption {
  key: string;
  dir: 'asc' | 'desc';
  label: string;
}

/** A built-in view: code, read-only, navigation. */
export interface SystemViewDef {
  id: string;
  name: string;
  /** Filter query string. */
  query: string;
  sort?: ViewSort | null;
  columns?: string[];
  parts?: Record<string, string[]>;
  tone?: 'error' | 'warning';
}

export interface ListRegistry<Row> {
  pageKey: string;
  locked: LockedColumnDef<Row>;
  columns: ColumnDef<Row>[];
  filters: FilterDef[];
  sorts: SortOption[];
  defaultSort: ViewSort;
  systemViews: SystemViewDef[];
  /** Ids pinned to the strip by default. Defaults to the first six system views. */
  pinned?: string[];
  /** System views that cannot be unpinned. Defaults to the first two. */
  lockedViewIds?: string[];
  /** False on a list that keeps built-in views only (no save, no per-view menu). Defaults to true. */
  customViews?: boolean;
  /** Query params that are never part of a view (search text, paging). */
  nonViewParams?: string[];
}
