/**
 * Bench Presence Service (#3406; widened to a named roster by #3415,
 * mockup-parity epic #3401)
 *
 * @module apps/api/src/bench/application/__tests__
 */
import { InMemoryCacheAdapter } from '@openlinker/shared/cache/testing';

import { BenchPresenceService } from '../services/bench-presence.service';

/** Mirrors `PRESENCE_TTL_SEC`, which the service keeps private. */
const TTL_MS = 30_000;

describe('BenchPresenceService (#3406/#3415)', () => {
  it('should report nobody else when the parcel is opened for the first time', async () => {
    const service = new BenchPresenceService(new InMemoryCacheAdapter());

    const result = await service.ping('work-1', 'user-a', 'Anna Kowalska');

    // An empty array is the ANSWER "nobody else", not a failure — asserted
    // explicitly so nothing later swaps it for a null or an absent field.
    expect(result).toEqual({ collision: false, others: [] });
  });

  it('should never list the caller themselves, however often they ping', async () => {
    const service = new BenchPresenceService(new InMemoryCacheAdapter());

    await service.ping('work-1', 'user-a', 'Anna Kowalska');
    const result = await service.ping('work-1', 'user-a', 'Anna Kowalska');

    expect(result).toEqual({ collision: false, others: [] });
  });

  it('should name the other packer with a MASKED name when someone else has it open', async () => {
    const service = new BenchPresenceService(new InMemoryCacheAdapter());

    await service.ping('work-1', 'user-a', 'Piotr Malinowski');
    const result = await service.ping('work-1', 'user-b', 'Anna Kowalska');

    expect(result).toEqual({ collision: true, others: [{ displayName: 'P. Malinowski' }] });
  });

  it('should never disclose a user id or an unmasked username to the caller', async () => {
    const service = new BenchPresenceService(new InMemoryCacheAdapter());

    await service.ping('work-1', 'user-a', 'Piotr Malinowski');
    const result = await service.ping('work-1', 'user-b', 'Anna Kowalska');

    // The whole payload, serialised — a field added later that leaked either
    // fact would fail here rather than only failing the shape assertion above.
    const wire = JSON.stringify(result);
    expect(wire).not.toContain('user-a');
    expect(wire).not.toContain('Piotr Malinowski');
  });

  it('should store the name already masked, so no later reader can un-mask it', async () => {
    const cache = new InMemoryCacheAdapter();
    const service = new BenchPresenceService(cache);

    await service.ping('work-1', 'user-a', 'Piotr Malinowski');

    // Masking on the way IN is the guarantee: the raw name was never written,
    // so a future field, a debug dump or a Redis inspection cannot recover it.
    expect(JSON.stringify(await cache.get('bench:viewing:work-1'))).not.toContain(
      'Piotr Malinowski'
    );
  });

  it('should list EVERY other packer, not just the most recent one', async () => {
    const service = new BenchPresenceService(new InMemoryCacheAdapter());

    await service.ping('work-1', 'user-a', 'Anna Kowalska');
    await service.ping('work-1', 'user-b', 'Piotr Malinowski');
    const result = await service.ping('work-1', 'user-c', 'Marta Nowak');

    // #3406's single-slot model could only ever name one, rotating between
    // them; three packers in one box is a real warehouse state.
    expect(result.collision).toBe(true);
    expect(result.others).toHaveLength(2);
    expect(result.others.map((viewer) => viewer.displayName).sort()).toEqual([
      'A. Kowalska',
      'P. Malinowski',
    ]);
  });

  it('should be mutual — both packers keep seeing each other while both keep pinging', async () => {
    const service = new BenchPresenceService(new InMemoryCacheAdapter());

    await service.ping('work-1', 'user-a', 'Anna Kowalska');
    const bSeesA = await service.ping('work-1', 'user-b', 'Piotr Malinowski');
    const aSeesB = await service.ping('work-1', 'user-a', 'Anna Kowalska');

    expect(bSeesA.others).toEqual([{ displayName: 'A. Kowalska' }]);
    expect(aSeesB.others).toEqual([{ displayName: 'P. Malinowski' }]);
  });

  it('should order the roster most recently seen first', async () => {
    jest.useFakeTimers();
    try {
      const service = new BenchPresenceService(new InMemoryCacheAdapter());

      await service.ping('work-1', 'user-a', 'Anna Kowalska');
      jest.advanceTimersByTime(1_000);
      await service.ping('work-1', 'user-b', 'Piotr Malinowski');
      jest.advanceTimersByTime(1_000);
      const result = await service.ping('work-1', 'user-c', 'Marta Nowak');

      expect(result.others.map((viewer) => viewer.displayName)).toEqual([
        'P. Malinowski',
        'A. Kowalska',
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('should drop a packer who stopped pinging even while another keeps the key alive', async () => {
    jest.useFakeTimers();
    try {
      const service = new BenchPresenceService(new InMemoryCacheAdapter());

      await service.ping('work-1', 'user-a', 'Anna Kowalska');
      // B keeps pinging throughout, which REFRESHES the Redis key's own TTL —
      // so A can only age out by their own recorded instant. This is the case
      // Redis expiry alone cannot cover, and the reason the instant is stored
      // per entry.
      await service.ping('work-1', 'user-b', 'Piotr Malinowski');
      jest.advanceTimersByTime(TTL_MS / 2);
      await service.ping('work-1', 'user-b', 'Piotr Malinowski');
      jest.advanceTimersByTime(TTL_MS / 2 + 1_000);
      const result = await service.ping('work-1', 'user-b', 'Piotr Malinowski');

      expect(result).toEqual({ collision: false, others: [] });
    } finally {
      jest.useRealTimers();
    }
  });

  it('should scope presence to the work id — two different parcels never collide', async () => {
    const service = new BenchPresenceService(new InMemoryCacheAdapter());

    await service.ping('work-1', 'user-a', 'Anna Kowalska');
    const result = await service.ping('work-2', 'user-b', 'Piotr Malinowski');

    expect(result).toEqual({ collision: false, others: [] });
  });

  it('should pass a single-token account name through unmasked', async () => {
    const service = new BenchPresenceService(new InMemoryCacheAdapter());

    await service.ping('work-1', 'user-a', 'admin');
    const result = await service.ping('work-1', 'user-b', 'Anna Kowalska');

    // No surname to keep and no first name to reduce; masking further would
    // destroy the only identifying fact rather than reduce it.
    expect(result.others).toEqual([{ displayName: 'admin' }]);
  });

  it('should tolerate a pre-#3415 single-claim value left in the cache by an older deploy', async () => {
    const cache = new InMemoryCacheAdapter();
    const service = new BenchPresenceService(cache);
    // Exactly what #3406 wrote. A cast would have thrown `TypeError` here, on
    // the parcel surface's own poll, for every parcel open across the deploy.
    cache.seed('bench:viewing:work-1', { userId: 'user-a', at: new Date().toISOString() }, 30);

    const result = await service.ping('work-1', 'user-b', 'Anna Kowalska');

    // One banner-free ping, then correct — the roster is rewritten in the new
    // shape by this very call.
    expect(result).toEqual({ collision: false, others: [] });
    const next = await service.ping('work-1', 'user-c', 'Marta Nowak');
    expect(next.others).toEqual([{ displayName: 'A. Kowalska' }]);
  });

  it('should drop an entry whose recorded instant cannot be parsed', async () => {
    const cache = new InMemoryCacheAdapter();
    const service = new BenchPresenceService(cache);
    // A corrupt entry that cannot be aged out would name a colleague who left
    // for as long as anyone keeps the parcel open.
    cache.seed(
      'bench:viewing:work-1',
      { viewers: [{ userId: 'user-a', displayName: 'A. Kowalska', at: 'not-a-date' }] },
      30
    );

    const result = await service.ping('work-1', 'user-b', 'Marta Nowak');

    expect(result).toEqual({ collision: false, others: [] });
  });
});
