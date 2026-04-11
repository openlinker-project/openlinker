/**
 * Connection Cursor Types
 *
 * Type definitions for connection cursor domain objects. Cursors track
 * incremental sync position per connection (e.g., lastEventId for
 * Allegro order event journal).
 *
 * @module libs/core/src/sync/domain/types
 */

export interface ConnectionCursor {
  connectionId: string;
  cursorKey: string;
  value: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectionCursorFilters {
  connectionId?: string;
}

export interface ConnectionCursorPagination {
  limit: number;
  offset: number;
}

export interface PaginatedConnectionCursors {
  items: ConnectionCursor[];
  total: number;
}
