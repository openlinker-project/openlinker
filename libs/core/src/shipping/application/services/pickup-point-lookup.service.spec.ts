/**
 * Pickup-Point Lookup Service unit tests (#766).
 *
 * Mocks IIntegrationsService (→ a finder-capable / courier-only adapter stub)
 * and PickupPointCachePort. Covers: live search + per-point write-through, the
 * unsupported-capability branch, and cache-write-through resilience.
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import { PickupPointLookupService } from './pickup-point-lookup.service';
import type { PickupPointCachePort } from '../../domain/ports/pickup-point-cache.port';
import type { PickupPointSearchCachePort } from '../../domain/ports/pickup-point-search-cache.port';
import type { PickupPointQueryStatsPort } from '../../domain/ports/pickup-point-query-stats.port';
import type { ShippingProviderManagerPort } from '../../domain/ports/shipping-provider-manager.port';
import type { PickupPointFinder } from '../../domain/ports/capabilities/pickup-point-finder.capability';
import type { PickupPoint } from '../../domain/types/pickup-point.types';
import { PickupPointFinderNotSupportedException } from '../../domain/exceptions/pickup-point-finder-not-supported.exception';

const CONN = 'conn-inpost';

function makePoint(overrides: Partial<PickupPoint> = {}): PickupPoint {
  return {
    providerId: 'POZ08A',
    name: 'Paczkomat POZ08A',
    address: { line1: 'Krakowska 12', city: 'Poznań', postalCode: '60-001', country: 'PL' },
    status: 'active',
    ...overrides,
  };
}

function finderAdapter(points: PickupPoint[]): ShippingProviderManagerPort & PickupPointFinder {
  return {
    generateLabel: jest.fn(),
    getTracking: jest.fn(),
    getSupportedMethods: jest.fn().mockReturnValue(['paczkomat']),
    findPickupPoints: jest.fn().mockResolvedValue(points),
  } as unknown as ShippingProviderManagerPort & PickupPointFinder;
}

function courierOnlyAdapter(): ShippingProviderManagerPort {
  return {
    generateLabel: jest.fn(),
    getTracking: jest.fn(),
    getSupportedMethods: jest.fn().mockReturnValue(['kurier']),
  } as unknown as ShippingProviderManagerPort;
}

describe('PickupPointLookupService', () => {
  let cache: jest.Mocked<PickupPointCachePort>;
  let searchCache: jest.Mocked<PickupPointSearchCachePort>;
  let stats: jest.Mocked<PickupPointQueryStatsPort>;
  let getCapabilityAdapter: jest.Mock;
  let service: PickupPointLookupService;

  beforeEach(() => {
    cache = { get: jest.fn(), put: jest.fn().mockResolvedValue(undefined) };
    // Default: result-cache miss, so existing tests exercise the live path.
    searchCache = {
      get: jest.fn().mockResolvedValue(null),
      put: jest.fn().mockResolvedValue(undefined),
    };
    stats = {
      record: jest.fn().mockResolvedValue(undefined),
      topQueries: jest.fn().mockResolvedValue([]),
    };
    getCapabilityAdapter = jest.fn();
    const integrations = { getCapabilityAdapter } as unknown as IIntegrationsService;
    service = new PickupPointLookupService(integrations, cache, searchCache, stats);
  });

  describe('search', () => {
    it('should return the live provider results when the adapter is a pickup-point finder', async () => {
      const points = [makePoint(), makePoint({ providerId: 'WAW01A' })];
      getCapabilityAdapter.mockResolvedValue(finderAdapter(points));

      const result = await service.search(CONN, { city: 'Poznań' });

      expect(result).toEqual(points);
      expect(getCapabilityAdapter).toHaveBeenCalledWith(CONN, 'ShippingProviderManager');
    });

    it('should write each returned point through to the cache', async () => {
      const points = [makePoint(), makePoint({ providerId: 'WAW01A' })];
      getCapabilityAdapter.mockResolvedValue(finderAdapter(points));

      await service.search(CONN, {});

      expect(cache.put).toHaveBeenCalledTimes(2);
      expect(cache.put).toHaveBeenCalledWith(points[0]);
      expect(cache.put).toHaveBeenCalledWith(points[1]);
    });

    it('should throw PickupPointFinderNotSupportedException when the adapter has no finder', async () => {
      getCapabilityAdapter.mockResolvedValue(courierOnlyAdapter());

      await expect(service.search(CONN, {})).rejects.toBeInstanceOf(
        PickupPointFinderNotSupportedException,
      );
      expect(cache.put).not.toHaveBeenCalled();
    });

    it('should still return live results when a cache write-through fails', async () => {
      const points = [makePoint()];
      getCapabilityAdapter.mockResolvedValue(finderAdapter(points));
      cache.put.mockRejectedValueOnce(new Error('redis down'));

      await expect(service.search(CONN, {})).resolves.toEqual(points);
    });

    it('should record query frequency (#849)', async () => {
      getCapabilityAdapter.mockResolvedValue(finderAdapter([makePoint()]));

      await service.search(CONN, { city: 'Poznań' });

      expect(stats.record).toHaveBeenCalledWith(CONN, { city: 'Poznań' });
    });

    it('should serve from the result cache and skip the provider on a hit (#849)', async () => {
      const cached = [makePoint(), makePoint({ providerId: 'WAW01A' })];
      searchCache.get.mockResolvedValue(cached);

      const result = await service.search(CONN, { city: 'Poznań' });

      expect(result).toEqual(cached);
      expect(stats.record).toHaveBeenCalledWith(CONN, { city: 'Poznań' });
      expect(getCapabilityAdapter).not.toHaveBeenCalled(); // provider not hit
      expect(cache.put).not.toHaveBeenCalled(); // no per-point warm on hit
    });

    it('should write the result list through to the search cache on a miss (#849)', async () => {
      const points = [makePoint()];
      getCapabilityAdapter.mockResolvedValue(finderAdapter(points));

      await service.search(CONN, { city: 'Poznań' });

      expect(searchCache.put).toHaveBeenCalledWith(CONN, { city: 'Poznań' }, points);
    });

    it('should still serve live when the search-cache read fails (#849)', async () => {
      const points = [makePoint()];
      searchCache.get.mockRejectedValueOnce(new Error('redis down'));
      getCapabilityAdapter.mockResolvedValue(finderAdapter(points));

      await expect(service.search(CONN, {})).resolves.toEqual(points);
    });
  });

  describe('refreshSearch (#849)', () => {
    it('should run a live search and warm both caches without recording frequency or reading the result cache', async () => {
      const points = [makePoint(), makePoint({ providerId: 'WAW01A' })];
      getCapabilityAdapter.mockResolvedValue(finderAdapter(points));

      await service.refreshSearch(CONN, { city: 'Poznań' });

      expect(stats.record).not.toHaveBeenCalled();
      expect(searchCache.get).not.toHaveBeenCalled();
      expect(cache.put).toHaveBeenCalledTimes(2);
      expect(searchCache.put).toHaveBeenCalledWith(CONN, { city: 'Poznań' }, points);
    });

    it('should throw PickupPointFinderNotSupportedException when the adapter has no finder', async () => {
      getCapabilityAdapter.mockResolvedValue(courierOnlyAdapter());

      await expect(service.refreshSearch(CONN, {})).rejects.toBeInstanceOf(
        PickupPointFinderNotSupportedException,
      );
    });
  });

  describe('getCachedPoint', () => {
    it('should return the cached point on hit', async () => {
      const point = makePoint();
      cache.get.mockResolvedValue(point);

      await expect(service.getCachedPoint('POZ08A')).resolves.toEqual(point);
      expect(cache.get).toHaveBeenCalledWith('POZ08A');
    });

    it('should return null on miss', async () => {
      cache.get.mockResolvedValue(null);
      await expect(service.getCachedPoint('NOPE')).resolves.toBeNull();
    });
  });
});
