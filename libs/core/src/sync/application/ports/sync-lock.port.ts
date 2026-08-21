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

  /**
   * Extend a held lock's TTL if the token still matches (compare-and-PEXPIRE).
   *
   * The heartbeat primitive for a long-lived singleton lease (#2279): a holder
   * extends well before expiry and treats `false` — the lock expired or was
   * claimed by another holder — as loss of the lease, never as an error.
   *
   * @param key - Lock key
   * @param token - Token returned from acquire()
   * @param ttlMs - New TTL in milliseconds, measured from now
   * @returns true if extended, false if the lock is no longer held by this token
   */
  extend(key: string, token: SyncLockToken, ttlMs: number): Promise<boolean>;
}

