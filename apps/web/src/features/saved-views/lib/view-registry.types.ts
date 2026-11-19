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
  /** Hides the column below this viewport width. */
  hideBelow?: 480 | 768 | 1024 | 1280;
  /** Text lines the cell renders at its tallest; feeds the loading skeleton only. */
  lines?: number;
  /** Header text for a single-field column, and the fallback for a stacked one with no sortable field visible. */
  header?: ReactNode;
  /** Sort key of a single-field column. */
  sortKey?: string;
  render?: (row: Row) => ReactNode;
  parts?: PartDef<Row>[];
  /**
   * Header-only controls of a stacked column: a label (sortable when `sort` is set) drawn in the
   * header after the visible fields' own labels. They have no body render and no entry in the
   * Columns panel, so a cell that already shows a value can still offer a sort for it.
   */
  headerControls?: Array<{ id: string; label: string; sort?: string }>;
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
  hideBelow?: 480 | 768 | 1024 | 1280;
  lines?: number;
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

/**
 * How a list spells its sort in the address, for a page whose URLs already carry
 * it as something other than `sort=key:dir` (Orders: `sort=total&dir=asc`). The
 * engine reads and writes through this instead of its own spelling, so adopting
 * saved views does not change a URL the app already produced.
 */
export interface SortCodec {
  /** `null` when the address carries no sort at all. */
  parse: (params: URLSearchParams) => ViewSort | null;
  /** Writes `sort` over `params`, removing every param it owns when `sort` is `null`. */
  write: (params: URLSearchParams, sort: ViewSort | null) => void;
}

/**
 * How a view's filter query is spelled in storage when the page's URL params do
 * not match the names the list endpoint validates a stored query against.
 */
export interface StoredQueryCodec {
  encode: (query: string) => string;
  decode: (query: string) => string;
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
  /** Params added to the default non-view list, so a page need not repeat it. */
  extraNonViewParams?: string[];
  /** Spelling of the sort in the address. Defaults to `sort=key:dir`. */
  sortCodec?: SortCodec;
  /** Spelling of the filter query in storage. Defaults to the address spelling. */
  storedQuery?: StoredQueryCodec;
  /** Name of the URL param carrying the applied view's id, for a page whose own `view` param is taken. Defaults to `view`. */
  viewParam?: string;
}
