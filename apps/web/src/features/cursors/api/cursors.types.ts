/**
 * Cursors Feature Types
 *
 * Frontend transport types for the cursors API. Mirrors the backend
 * CursorResponseDto and PaginatedCursorsResponseDto contracts.
 * All date fields are ISO 8601 strings.
 *
 * @module apps/web/src/features/cursors/api
 */

export interface Cursor {
  connectionId: string;
  cursorKey: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

export interface CursorFilters {
  connectionId?: string;
}

export interface CursorPagination {
  limit?: number;
  offset?: number;
}

export interface PaginatedCursors {
  items: Cursor[];
  total: number;
  limit: number;
  offset: number;
}
