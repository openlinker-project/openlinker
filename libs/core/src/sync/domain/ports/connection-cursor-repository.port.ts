/**
 * Connection Cursor Repository Port
 *
 * Defines the contract for connection cursor persistence operations. Cursors
 * are used to track incremental sync state per connection (e.g., lastEventId
 * for Allegro order event journal). Implemented by infrastructure repositories
 * to provide cursor storage capabilities.
 *
 * @module libs/core/src/sync/domain/ports
 * @see {@link ConnectionCursorRepository} for the TypeORM implementation
 */

/**
 * Connection Cursor Repository Port
 *
 * Interface for connection cursor persistence operations. Cursors are key-value
 * pairs scoped to a connection and a cursor key (e.g., 'allegro.orders.lastEventId').
 * Implementations handle the specifics of the underlying database technology
 * and ensure atomic updates for cursor advancement.
 */
import type {
  ConnectionCursor,
  ConnectionCursorFilters,
  ConnectionCursorPagination,
  PaginatedConnectionCursors,
} from '../types/connection-cursor.types';

export interface ConnectionCursorRepositoryPort {
  /**
   * Get cursor value for a connection and cursor key
   *
   * @param connectionId - Connection identifier (UUID)
   * @param cursorKey - Cursor key identifier (e.g., 'allegro.orders.lastEventId')
   * @returns Cursor value (string) or null if not found
   */
  get(connectionId: string, cursorKey: string): Promise<string | null>;

  /**
   * Set cursor value for a connection and cursor key
   *
   * Creates or updates the cursor atomically. If cursor doesn't exist, creates it.
   * If it exists, updates it. This operation should be idempotent and safe for
   * concurrent updates (use database-level constraints/upsert if needed).
   *
   * @param connectionId - Connection identifier (UUID)
   * @param cursorKey - Cursor key identifier (e.g., 'allegro.orders.lastEventId')
   * @param value - Cursor value (string)
   */
  set(connectionId: string, cursorKey: string, value: string): Promise<void>;

  /**
   * Set the cursor only when the new value sorts strictly after the stored one.
   *
   * For a cursor used as a freshness MARK, a plain `set` is the wrong write: a
   * caller whose lock expired mid-call can move the mark backwards and admit a
   * stale write behind it (#2609 review of #2617). One statement decides, so
   * two concurrent advances cannot both win.
   *
   * PRECONDITION: values are fixed-width, same-format strings that sort in
   * chronological order - ISO-8601 UTC timestamps as produced by
   * `Date.toISOString()`. The comparison is textual, so it never throws on an
   * unexpected value; it simply refuses.
   *
   * @returns true when the stored value moved, false when it was already at or
   *          ahead of `value`
   */
  advanceIfGreater(connectionId: string, cursorKey: string, value: string): Promise<boolean>;

  /**
   * Delete cursor for a connection and cursor key
   *
   * Useful for resetting sync state or cleanup.
   *
   * @param connectionId - Connection identifier (UUID)
   * @param cursorKey - Cursor key identifier
   */
  delete(connectionId: string, cursorKey: string): Promise<void>;

  /**
   * Find cursors with optional filters and pagination
   *
   * Returns a paginated list of cursors, optionally filtered by connectionId.
   * Results are ordered by updatedAt descending (most recently updated first).
   *
   * @param filters - Optional filters (connectionId)
   * @param pagination - Pagination options (limit, offset)
   * @returns Paginated cursor list with total count
   */
  findMany(
    filters?: ConnectionCursorFilters,
    pagination?: ConnectionCursorPagination,
  ): Promise<PaginatedConnectionCursors>;

  /**
   * Find a single cursor by connectionId and cursorKey
   *
   * @param connectionId - Connection identifier (UUID)
   * @param cursorKey - Cursor key identifier
   * @returns Full cursor object or null if not found
   */
  findOne(connectionId: string, cursorKey: string): Promise<ConnectionCursor | null>;

  /**
   * When any of this connection's cursors last advanced, or null when it
   * holds none.
   *
   * A dedicated read rather than a limit-1 page of `findMany`, which pays a
   * `COUNT(*)` over every cursor row and discards it.
   *
   * @param connectionId - Connection UUID
   */
  findMostRecentUpdate(connectionId: string): Promise<Date | null>;
}
