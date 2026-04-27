/**
 * Redis Cache Adapter Unit Tests
 *
 * Verifies JSON round-trip, TTL forwarding, miss → null, parse-failure → null,
 * delete behavior. The Redis client is mocked at the constructor seam.
 *
 * @module libs/shared/src/cache
 */
import type { RedisClientType } from 'redis';
import { RedisCacheAdapter } from '../redis-cache.adapter';

interface MockRedis {
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
}

function makeAdapter(): { adapter: RedisCacheAdapter; redis: MockRedis } {
  const redis: MockRedis = {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  };
  const adapter = new RedisCacheAdapter(redis as unknown as RedisClientType);
  return { adapter, redis };
}

describe('RedisCacheAdapter', () => {
  describe('get', () => {
    it('returns null on cache miss', async () => {
      const { adapter, redis } = makeAdapter();
      redis.get.mockResolvedValueOnce(null);
      await expect(adapter.get('missing')).resolves.toBeNull();
      expect(redis.get).toHaveBeenCalledWith('missing');
    });

    it('parses JSON and returns the typed value', async () => {
      const { adapter, redis } = makeAdapter();
      const stored = { hello: 'world', nested: { n: 1 } };
      redis.get.mockResolvedValueOnce(JSON.stringify(stored));
      await expect(adapter.get<typeof stored>('hit')).resolves.toEqual(stored);
    });

    it('returns null and logs a warning when stored value is malformed JSON', async () => {
      const { adapter, redis } = makeAdapter();
      redis.get.mockResolvedValueOnce('{not valid json');
      await expect(adapter.get('bad')).resolves.toBeNull();
    });
  });

  describe('set', () => {
    it('JSON-stringifies the value and forwards TTL via { EX }', async () => {
      const { adapter, redis } = makeAdapter();
      const value = { a: 1, b: ['x', 'y'] };
      await adapter.set('key', value, 3600);
      expect(redis.set).toHaveBeenCalledWith('key', JSON.stringify(value), { EX: 3600 });
    });

    it('honors a 1-second TTL (boundary)', async () => {
      const { adapter, redis } = makeAdapter();
      await adapter.set('key', 'v', 1);
      expect(redis.set).toHaveBeenCalledWith('key', JSON.stringify('v'), { EX: 1 });
    });
  });

  describe('delete', () => {
    it('forwards the key to client.del', async () => {
      const { adapter, redis } = makeAdapter();
      await adapter.delete('to-remove');
      expect(redis.del).toHaveBeenCalledWith('to-remove');
    });
  });
});
