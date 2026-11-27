/**
 * KSeF Rate-Limit Stores — Unit Specs (DEF-05 / DEF-06)
 *
 * The Lua script itself needs a real Redis and is exercised by the live e2e;
 * here the Redis store is pinned on the keys and arguments it sends, and the
 * in-memory store on the rolling-window rule.
 *
 * @module libs/integrations/ksef/src/infrastructure/http
 */
import {
  InMemoryKsefRateLimitStore,
  RedisKsefRateLimitStore,
  type KsefRateLimitRedisClient,
} from '../ksef-rate-limit-stores';

const HOUR = 3_600_000;

describe('InMemoryKsefRateLimitStore', () => {
  it('should admit all demands together or none of them', async () => {
    let now = 0;
    const store = new InMemoryKsefRateLimitStore(() => now);
    const round = [
      { category: 'session-open' as const, perHour: 2 },
      { category: 'invoice-submit' as const, perHour: 1 },
    ];

    expect(await store.tryReserve('b', round, HOUR)).toEqual({ admitted: true });
    now = 10;
    expect(await store.tryReserve('b', round, HOUR)).toEqual({ admitted: false, retryAfterMs: HOUR - 10 });
    // The refused round left session-open with one slot still free.
    expect(await store.tryReserve('b', [{ category: 'session-open', perHour: 2 }], HOUR)).toEqual({
      admitted: true,
    });
  });

  it('should free a slot exactly when the oldest entry is an hour old', async () => {
    let now = 0;
    const store = new InMemoryKsefRateLimitStore(() => now);
    const demand = [{ category: 'session-close' as const, perHour: 1 }];

    await store.tryReserve('b', demand, HOUR);
    now = HOUR - 1;
    expect((await store.tryReserve('b', demand, HOUR)).admitted).toBe(false);
    now = HOUR;
    expect((await store.tryReserve('b', demand, HOUR)).admitted).toBe(true);
  });
});

describe('RedisKsefRateLimitStore', () => {
  function client(reply: [number, number]): KsefRateLimitRedisClient & { eval: jest.Mock } {
    return { eval: jest.fn().mockResolvedValue(reply) };
  }

  it('should send one hash-tagged key per category and each ceiling', async () => {
    const redis = client([1, 0]);
    const store = new RedisKsefRateLimitStore(redis);

    const outcome = await store.tryReserve(
      'test:1189981779',
      [
        { category: 'session-open', perHour: 108 },
        { category: 'session-close', perHour: 108 },
      ],
      HOUR,
    );

    expect(outcome).toEqual({ admitted: true });
    const [, options] = redis.eval.mock.calls[0] as [string, { keys: string[]; arguments: string[] }];
    expect(options.keys).toEqual([
      'ksef:rl:{test:1189981779}:session-open',
      'ksef:rl:{test:1189981779}:session-close',
    ]);
    expect(options.arguments[0]).toBe(String(HOUR));
    expect(options.arguments.slice(2)).toEqual(['108', '108']);
  });

  it('should report the wait the script returns', async () => {
    const store = new RedisKsefRateLimitStore(client([0, 4200]));

    expect(
      await store.tryReserve('b', [{ category: 'session-open', perHour: 1 }], HOUR),
    ).toEqual({ admitted: false, retryAfterMs: 4200 });
  });
});
