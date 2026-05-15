/**
 * Sync Cursors Service Interface
 *
 * Cross-context application surface for reading and advancing
 * connection-scoped sync cursors (#718). Wraps the persistence-layer
 * `ConnectionCursorRepositoryPort` so consumers don't reach across
 * context boundaries to a repository port.
 *
 * @module libs/core/src/sync/application/services
 * @see {@link SyncCursorsService} for the implementation
 */

export interface ISyncCursorsService {
  /**
   * Read the current cursor value for a connection + cursor-key pair.
   * Returns null when no row exists (treat as "from beginning").
   */
  getCursor(connectionId: string, cursorKey: string): Promise<string | null>;

  /**
   * Set the cursor for a connection + cursor-key pair to `value`.
   * Creates the row if missing, updates otherwise. Idempotent and
   * safe for concurrent advances (atomic upsert in the persistence
   * layer).
   *
   * **Monotonicity is the caller's responsibility.** The underlying
   * repository upserts unconditionally — it does NOT reject a value
   * lower than the current one. Callers that need monotonic-only
   * advancement must read with `getCursor` and apply the comparison
   * themselves before calling this method.
   */
  advanceCursor(connectionId: string, cursorKey: string, value: string): Promise<void>;
}
