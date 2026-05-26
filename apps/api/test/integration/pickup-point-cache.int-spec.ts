/**
 * Pickup-Point Cache Integration Test (#766)
 *
 * Proves the Redis-backed `PickupPointCachePort` wiring end-to-end against a
 * real Redis (Testcontainers): the @Global `CacheModule` resolves
 * `CACHE_PORT_TOKEN` into `RedisPickupPointCacheAdapter`, and a full
 * `PickupPoint` — nested address, structured opening-hours grid,
 * `temporarily-unavailable` status — round-trips through JSON serialization
 * intact. Key construction / TTL value are unit-covered (adapter spec); this
 * covers the seam those miss: DI resolution + real-Redis serialization fidelity.
 *
 * @module apps/api/test/integration
 */
import {
  PICKUP_POINT_CACHE_TOKEN,
  type PickupPoint,
  type PickupPointCachePort,
} from '@openlinker/core/shipping';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

const point: PickupPoint = {
  providerId: 'POZ08A',
  name: 'Paczkomat POZ08A',
  address: {
    line1: 'ul. Krakowska 12',
    line2: 'obok sklepu',
    city: 'Poznań',
    postalCode: '60-001',
    country: 'PL',
  },
  status: 'temporarily-unavailable',
  lat: 52.4064,
  lon: 16.9252,
  openingHours: {
    mo: { intervals: [{ open: '08:00', close: '20:00' }] },
    tu: { intervals: [{ open: '08:00', close: '20:00' }] },
    we: { intervals: [{ open: '08:00', close: '20:00' }] },
    th: { intervals: [{ open: '08:00', close: '20:00' }] },
    fr: { intervals: [{ open: '08:00', close: '20:00' }] },
    sa: { intervals: [{ open: '10:00', close: '14:00' }] },
    su: { intervals: null },
  },
};

describe('Pickup-Point Cache Integration', () => {
  let harness: IntegrationTestHarness;
  let cache: PickupPointCachePort;

  beforeAll(async () => {
    harness = await getTestHarness();
    cache = harness.getApp().get<PickupPointCachePort>(PICKUP_POINT_CACHE_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should round-trip a full pickup point through real Redis', async () => {
    await cache.put(point);

    const result = await cache.get('POZ08A');

    expect(result).toEqual(point);
  });

  it('should return null for an uncached provider id', async () => {
    await expect(cache.get('DOES-NOT-EXIST')).resolves.toBeNull();
  });
});
