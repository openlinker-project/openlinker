/**
 * In-Memory Cache Adapter
 *
 * Test-time-only adapter implementing `CachePort`. Backed by an internal
 * `Map<string, { value: unknown; expiresAt: number }>`. TTL is honored by
 * storing `Date.now() + ttlSec * 1000` and checking against `Date.now()` on
 * each `get` — expired entries return `null` and are deleted lazily.
 *
 * **Placement**: lives at `cache/testing/` rather than
 * `cache/infrastructure/adapters/` because `libs/shared` does not use the
 * full hexagonal layered structure (no `domain/`, `application/`,
 * `infrastructure/` split there) and this adapter is never wired into a
 * production module graph anyway — only consumed by `*.spec.ts` files.
 *
 * **TTL testing**: the adapter reads `Date.now()` directly. Jest 29's modern
 * fake timers (the default since Jest 27) mock `Date.now()`, so a spec can
 * call `jest.useFakeTimers()` + `jest.advanceTimersByTime(ms)` to step past
 * an entry's expiry without sleeping. To pin to an absolute wall-clock time
 * instead (e.g. to test boundary semantics around midnight), use
 * `jest.setSystemTime(new Date(...))` or `useFakeTimers({ now: <ms> })`.
 * See `in-memory-cache.adapter.spec.ts` for a worked example.
 *
 * @module libs/shared/src/cache/testing
 * @see {@link CachePort} for the port contract
 */
import type { CachePort } from '../cache.port';

interface Entry {
  value: unknown;
  expiresAt: number;
}

export class InMemoryCacheAdapter implements CachePort {
  private readonly store = new Map<string, Entry>();

  get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) {
      return Promise.resolve(null);
    }
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value as T);
  }

  set<T>(key: string, value: T, ttlSec: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }

  // ----- test helpers (not part of the port contract) -----

  clear(): void {
    this.store.clear();
  }

  /**
   * Number of entries currently held (including any expired ones not yet
   * lazily evicted). Useful for asserting on cache pressure in higher-level
   * code without exposing the internal `Map`.
   */
  size(): number {
    return this.store.size;
  }

  /**
   * Pre-populate without going through `set`. Same TTL semantics —
   * `ttlSec` is the lifetime in seconds from the moment `seed` is called.
   */
  seed<T>(key: string, value: T, ttlSec: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  }
}
