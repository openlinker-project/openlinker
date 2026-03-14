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
   * Delete cursor for a connection and cursor key
   *
   * Useful for resetting sync state or cleanup.
   *
   * @param connectionId - Connection identifier (UUID)
   * @param cursorKey - Cursor key identifier
   */
  delete(connectionId: string, cursorKey: string): Promise<void>;
}



