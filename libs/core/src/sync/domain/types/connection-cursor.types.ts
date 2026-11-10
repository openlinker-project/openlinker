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
  /** Only keys starting with this prefix (#4023). Matched literally, never as a pattern. */
  keyPrefix?: string;
  /** Leave out keys starting with this prefix (#4023). Matched literally. */
  excludeKeyPrefix?: string;
}

/**
 * Aggregate of one connection's cursors under a key prefix (#4023). Used for
 * the per-listing stock write marks, which are one row per mapped offer and
 * would otherwise bury every cursor an operator actually reads.
 */
export interface ConnectionCursorPrefixSummary {
  connectionId: string;
  count: number;
  /** Lexically smallest value; the marks are ISO-8601 UTC, so this is the oldest. */
  oldestValue: string;
  newestValue: string;
  lastUpdatedAt: Date;
}

export interface ConnectionCursorPagination {
  limit: number;
  offset: number;
}

export interface PaginatedConnectionCursors {
  items: ConnectionCursor[];
  total: number;
}
