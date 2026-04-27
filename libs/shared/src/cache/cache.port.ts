/**
 * Cache Port
 *
 * Marketplace-neutral contract for distributed key-value caching. Wraps the
 * underlying Redis client behind a refactor-safe Symbol token (`CACHE_PORT_TOKEN`)
 * so adapters depend on the abstraction rather than the global 'REDIS_CLIENT'
 * string token. Values are JSON-serialized at the boundary.
 *
 * @module libs/shared/src/cache
 */
export interface CachePort {
  /**
   * Read a value by key. Returns null on miss or on JSON parse failure.
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Write a value with a hard TTL (seconds). Implementations MUST honor the
   * TTL — callers rely on this for cache freshness contracts.
   */
  set<T>(key: string, value: T, ttlSec: number): Promise<void>;

  /**
   * Remove a value by key. No-op if the key does not exist.
   */
  delete(key: string): Promise<void>;
}
