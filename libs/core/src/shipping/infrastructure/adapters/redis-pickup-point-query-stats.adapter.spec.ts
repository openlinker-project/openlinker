/**
 * Redis pickup-point query-stats adapter unit tests (#849).
 *
 * Mocks the raw Redis client's ZSET ops. Asserts record (ZINCRBY + rolling
 * EXPIRE + cardinality cap) and topQueries (reverse ZRANGE → reconstructed
 * queries, most-frequent first).
 */
import type { RedisClientType } from 'redis';
import { RedisPickupPointQueryStatsAdapter } from './redis-pickup-point-query-stats.adapter';

interface MockRedis {
  zIncrBy: jest.Mock;
  expire: jest.Mock;
  zRemRangeByRank: jest.Mock;
  zRange: jest.Mock;
}

describe('RedisPickupPointQueryStatsAdapter', () => {
  let redis: MockRedis;
  let adapter: RedisPickupPointQueryStatsAdapter;

  beforeEach(() => {
    redis = {
      zIncrBy: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(true),
      zRemRangeByRank: jest.fn().mockResolvedValue(0),
      zRange: jest.fn().mockResolvedValue([]),
    };
    adapter = new RedisPickupPointQueryStatsAdapter(redis as unknown as RedisClientType);
  });

  describe('record', () => {
    it('increments the connection ZSET, refreshes the rolling window, and caps cardinality', async () => {
      await adapter.record('conn-1', { city: 'Poznań', limit: 5 });

      expect(redis.zIncrBy).toHaveBeenCalledTimes(1);
      const [key, increment, member] = redis.zIncrBy.mock.calls[0];
      expect(key).toBe('paczkomat:freq:conn-1');
      expect(increment).toBe(1);
      // limit excluded from the member
      expect(member).toBe(JSON.stringify({ city: 'poznań' }));

      expect(redis.expire).toHaveBeenCalledWith('paczkomat:freq:conn-1', 7 * 86_400);
      // keep only the top 500 (rank 0 = lowest score)
      expect(redis.zRemRangeByRank).toHaveBeenCalledWith('paczkomat:freq:conn-1', 0, -501);
    });

    it('does not track the empty/unfiltered query', async () => {
      await adapter.record('conn-1', {});
      await adapter.record('conn-1', { city: '   ', limit: 10 });

      expect(redis.zIncrBy).not.toHaveBeenCalled();
    });
  });

  describe('topQueries', () => {
    it('reads the top-N descending and reconstructs queries', async () => {
      redis.zRange.mockResolvedValue([
        JSON.stringify({ city: 'poznań' }),
        JSON.stringify({ postalCode: '00-001' }),
      ]);

      const result = await adapter.topQueries('conn-1', 2);

      expect(redis.zRange).toHaveBeenCalledWith('paczkomat:freq:conn-1', 0, 1, { REV: true });
      expect(result).toEqual([
        { city: 'poznań', postalCode: undefined, searchText: undefined },
        { city: undefined, postalCode: '00-001', searchText: undefined },
      ]);
    });

    it('returns [] for a non-positive limit without hitting Redis', async () => {
      await expect(adapter.topQueries('conn-1', 0)).resolves.toEqual([]);
      expect(redis.zRange).not.toHaveBeenCalled();
    });
  });
});
