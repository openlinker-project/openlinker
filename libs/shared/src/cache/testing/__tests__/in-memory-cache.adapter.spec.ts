/**
 * InMemoryCacheAdapter Tests
 *
 * @module libs/shared/src/cache/testing
 */
import { InMemoryCacheAdapter } from '../in-memory-cache.adapter';

describe('InMemoryCacheAdapter', () => {
  it('should return null on a miss', async () => {
    const cache = new InMemoryCacheAdapter();

    expect(await cache.get('missing')).toBeNull();
  });

  it('should round-trip set + get', async () => {
    const cache = new InMemoryCacheAdapter();

    await cache.set('k', { hello: 'world' }, 60);

    expect(await cache.get<{ hello: string }>('k')).toEqual({ hello: 'world' });
  });

  it('should delete the entry on delete()', async () => {
    const cache = new InMemoryCacheAdapter();
    await cache.set('k', 'v', 60);

    await cache.delete('k');

    expect(await cache.get('k')).toBeNull();
  });

  it('should respect TTL — expired entries return null and are lazily evicted', async () => {
    jest.useFakeTimers();
    try {
      const cache = new InMemoryCacheAdapter();
      await cache.set('k', 'v', 30); // 30s TTL
      expect(cache.size()).toBe(1);

      jest.advanceTimersByTime(31_000); // jump past expiry

      expect(await cache.get('k')).toBeNull();
      // get() lazily evicts on miss
      expect(cache.size()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('should drop all entries on clear()', async () => {
    const cache = new InMemoryCacheAdapter();
    await cache.set('a', 1, 60);
    await cache.set('b', 2, 60);

    cache.clear();

    expect(cache.size()).toBe(0);
    expect(await cache.get('a')).toBeNull();
  });

  it('should pre-populate without going through set when seed() is used', async () => {
    const cache = new InMemoryCacheAdapter();

    cache.seed('k', 'pre-seeded', 60);

    expect(await cache.get('k')).toBe('pre-seeded');
  });

  it('should report size() across all entries (expired or not, until lazy eviction)', async () => {
    const cache = new InMemoryCacheAdapter();
    expect(cache.size()).toBe(0);

    await cache.set('a', 1, 60);
    await cache.set('b', 2, 60);

    expect(cache.size()).toBe(2);
  });
});
