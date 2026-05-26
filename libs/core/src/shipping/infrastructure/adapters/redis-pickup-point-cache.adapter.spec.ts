/**
 * Redis Pickup-Point Cache Adapter unit tests (#766).
 *
 * The adapter's only logic is key construction + the fixed TTL + delegation to
 * the shared CachePort, so this mocks CachePort and asserts exactly that.
 * Real-Redis serialization fidelity is covered by the integration spec.
 */
import type { CachePort } from '@openlinker/shared/cache';
import {
  PICKUP_POINT_CACHE_TTL_SECONDS,
  RedisPickupPointCacheAdapter,
} from './redis-pickup-point-cache.adapter';
import type { PickupPoint } from '../../domain/types/pickup-point.types';

const point: PickupPoint = {
  providerId: 'POZ08A',
  name: 'Paczkomat POZ08A',
  address: { line1: 'Krakowska 12', city: 'Poznań', postalCode: '60-001', country: 'PL' },
  status: 'temporarily-unavailable',
};

describe('RedisPickupPointCacheAdapter', () => {
  let cache: jest.Mocked<CachePort>;
  let adapter: RedisPickupPointCacheAdapter;

  beforeEach(() => {
    cache = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn(),
    };
    adapter = new RedisPickupPointCacheAdapter(cache);
  });

  describe('get', () => {
    it('should read by the namespaced provider-id key', async () => {
      cache.get.mockResolvedValue(point);

      const result = await adapter.get('POZ08A');

      expect(result).toEqual(point);
      expect(cache.get).toHaveBeenCalledWith('paczkomat:point:POZ08A');
    });

    it('should return null on cache miss', async () => {
      cache.get.mockResolvedValue(null);
      await expect(adapter.get('NOPE')).resolves.toBeNull();
    });
  });

  describe('put', () => {
    it('should write the point under its provider-id key with a 24h TTL', async () => {
      await adapter.put(point);

      expect(cache.set).toHaveBeenCalledWith(
        'paczkomat:point:POZ08A',
        point,
        PICKUP_POINT_CACHE_TTL_SECONDS,
      );
      expect(PICKUP_POINT_CACHE_TTL_SECONDS).toBe(86_400);
    });
  });
});
