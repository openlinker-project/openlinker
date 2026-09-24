/**
 * Bench Presence Service (#3406, mockup-parity epic #3401)
 *
 * @module apps/api/src/bench/application/__tests__
 */
import { InMemoryCacheAdapter } from '@openlinker/shared/cache/testing';

import { BenchPresenceService } from '../services/bench-presence.service';

describe('BenchPresenceService (#3406)', () => {
  it('reports no collision on the very first ping', async () => {
    const service = new BenchPresenceService(new InMemoryCacheAdapter());

    const result = await service.ping('work-1', 'user-a');

    expect(result).toEqual({ collision: false, otherUserId: null });
  });

  it('reports no collision when the caller pings their own claim again', async () => {
    const cache = new InMemoryCacheAdapter();
    const service = new BenchPresenceService(cache);

    await service.ping('work-1', 'user-a');
    const result = await service.ping('work-1', 'user-a');

    expect(result).toEqual({ collision: false, otherUserId: null });
  });

  it('reports a collision when a DIFFERENT user pinged the same parcel', async () => {
    const cache = new InMemoryCacheAdapter();
    const service = new BenchPresenceService(cache);

    await service.ping('work-1', 'user-a');
    const result = await service.ping('work-1', 'user-b');

    expect(result).toEqual({ collision: true, otherUserId: 'user-a' });
  });

  it('is mutual — both packers keep seeing each other while both keep pinging', async () => {
    const cache = new InMemoryCacheAdapter();
    const service = new BenchPresenceService(cache);

    await service.ping('work-1', 'user-a');
    const bSeesA = await service.ping('work-1', 'user-b');
    const aSeesB = await service.ping('work-1', 'user-a');

    expect(bSeesA).toEqual({ collision: true, otherUserId: 'user-a' });
    expect(aSeesB).toEqual({ collision: true, otherUserId: 'user-b' });
  });

  it('self-clears once the other packer stops pinging and the survivor pings again', async () => {
    const cache = new InMemoryCacheAdapter();
    const service = new BenchPresenceService(cache);

    await service.ping('work-1', 'user-a');
    await service.ping('work-1', 'user-b'); // B claims the key
    // A pings again: reads B (collision), then overwrites with A.
    await service.ping('work-1', 'user-a');
    // A pings a THIRD time with nobody else in between: reads its own last
    // write and sees no collision — the banner has cleared with no explicit
    // "leave" call.
    const result = await service.ping('work-1', 'user-a');

    expect(result).toEqual({ collision: false, otherUserId: null });
  });

  it('scopes the collision to the work id — two different parcels never collide', async () => {
    const cache = new InMemoryCacheAdapter();
    const service = new BenchPresenceService(cache);

    await service.ping('work-1', 'user-a');
    const result = await service.ping('work-2', 'user-b');

    expect(result).toEqual({ collision: false, otherUserId: null });
  });
});
