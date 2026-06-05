/**
 * Redis pickup-point search-cache adapter unit tests (#849).
 *
 * Mocks the shared CachePort. Asserts the limit-inclusive key shape, the
 * 1h-default TTL on write, and round-trip read.
 */
import type { CachePort } from '@openlinker/shared/cache';
import { RedisPickupPointSearchCacheAdapter } from './redis-pickup-point-search-cache.adapter';
import type { PickupPoint } from '../../domain/types/pickup-point.types';

function makePoint(providerId = 'POZ08A'): PickupPoint {
  return {
    providerId,
    name: `Paczkomat ${providerId}`,
    address: { line1: 'Krakowska 12', city: 'Poznań', postalCode: '60-001', country: 'PL' },
    status: 'active',
  };
}

describe('RedisPickupPointSearchCacheAdapter', () => {
  let cache: jest.Mocked<CachePort>;
  let adapter: RedisPickupPointSearchCacheAdapter;

  beforeEach(() => {
    cache = { get: jest.fn(), set: jest.fn().mockResolvedValue(undefined), delete: jest.fn() };
    adapter = new RedisPickupPointSearchCacheAdapter(cache);
  });

  it('writes the list under a connection- and limit-scoped key with the default 1h TTL', async () => {
    const points = [makePoint(), makePoint('WAW01A')];

    await adapter.put('conn-1', { city: 'Poznań', limit: 5 }, points);

    expect(cache.set).toHaveBeenCalledTimes(1);
    const [key, value, ttl] = cache.set.mock.calls[0];
    expect(key).toContain('paczkomat:search:conn-1:');
    expect(key).toContain('limit=5');
    expect(value).toEqual(points);
    expect(ttl).toBe(3_600);
  });

  it('reads from the same key it writes', async () => {
    const points = [makePoint()];
    cache.get.mockResolvedValue(points);

    await expect(adapter.get('conn-1', { city: 'Poznań' })).resolves.toEqual(points);
    const getKey = cache.get.mock.calls[0][0];
    expect(getKey).toContain('paczkomat:search:conn-1:');
    expect(getKey).toContain('limit=none');
  });

  it('uses distinct keys for different limits', async () => {
    await adapter.put('conn-1', { city: 'Poznań', limit: 5 }, []);
    await adapter.put('conn-1', { city: 'Poznań', limit: 50 }, []);
    expect(cache.set.mock.calls[0][0]).not.toBe(cache.set.mock.calls[1][0]);
  });

  it('returns null on a miss', async () => {
    cache.get.mockResolvedValue(null);
    await expect(adapter.get('conn-1', {})).resolves.toBeNull();
  });
});
