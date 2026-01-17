/**
 * Sync Lock Port (Application Layer)
 *
 * Application-level abstraction for distributed locks used by sync orchestration.
 * This enables single-flight execution per (connectionId, capability, jobType, etc.).
 *
 * Domain note: locking is orchestration, not domain logic.
 *
 * @module libs/core/src/sync/application/ports
 */

/**
 * A lock handle token returned by the lock implementation.
 *
 * Implementations should generate a unique token per acquisition attempt and
 * use it for safe release (compare-and-delete).
 */
export type SyncLockToken = string;

export interface SyncLockPort {
  /**
   * Attempt to acquire a lock for the given key.
   *
   * @param key - Lock key (e.g., `marketplace:orders:poll:<connectionId>`)
   * @param ttlMs - Lock TTL in milliseconds
   * @returns token if acquired, otherwise null
   */
  acquire(key: string, ttlMs: number): Promise<SyncLockToken | null>;

  /**
   * Release a lock if the token matches.
   *
   * @param key - Lock key
   * @param token - Token returned from acquire()
   * @returns true if released, false otherwise
   */
  release(key: string, token: SyncLockToken): Promise<boolean>;
}

