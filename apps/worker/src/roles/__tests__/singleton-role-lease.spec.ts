/**
 * Singleton Role Lease Unit Tests
 *
 * Pins the acquire-or-park lease (#2279, ADR-051). The load-bearing
 * properties: only the winner runs `onAcquired`; a held lease is EXTENDED
 * (never re-acquired); `extend === false` means the lease moved, so `onLost`
 * fires exactly once and the process goes back to competing; a Redis throw
 * while holding is NOT loss (the lock is still there and the next tick retries
 * inside the same TTL); ticks never overlap; and `stop()` releases so failover
 * doesn't wait out the TTL.
 *
 * @module apps/worker/src/roles
 */
import type { SyncLockPort } from '@openlinker/core/sync';
import { SingletonRoleLease } from '../singleton-role-lease';

describe('SingletonRoleLease', () => {
  let syncLock: jest.Mocked<SyncLockPort>;
  let onAcquired: jest.Mock;
  let onLost: jest.Mock;
  let lease: SingletonRoleLease;

  /** Let the immediate tick fired by start() settle. */
  const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  beforeEach(() => {
    syncLock = {
      acquire: jest.fn().mockResolvedValue('tok-1'),
      release: jest.fn().mockResolvedValue(true),
      extend: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<SyncLockPort>;
    onAcquired = jest.fn();
    onLost = jest.fn();
    lease = new SingletonRoleLease({
      lockKey: 'singleton:scheduler',
      ttlMs: 60_000,
      syncLock,
      onAcquired,
      onLost,
    });
  });

  afterEach(async () => {
    await lease.stop();
  });

  it('competes immediately on start rather than waiting one interval', async () => {
    lease.start();
    await settle();

    expect(syncLock.acquire).toHaveBeenCalledWith('singleton:scheduler', 60_000);
    expect(onAcquired).toHaveBeenCalledTimes(1);
    expect(lease.isHolding()).toBe(true);
  });

  it('parks without running onAcquired when another process holds the lock', async () => {
    syncLock.acquire.mockResolvedValue(null);

    lease.start();
    await settle();

    expect(onAcquired).not.toHaveBeenCalled();
    expect(onLost).not.toHaveBeenCalled();
    expect(lease.isHolding()).toBe(false);
  });

  it('is idempotent: a second start does not double-acquire', async () => {
    lease.start();
    await settle();
    lease.start();
    await settle();

    expect(syncLock.acquire).toHaveBeenCalledTimes(1);
    expect(onAcquired).toHaveBeenCalledTimes(1);
  });

  it('releases the lock on stop so failover does not wait out the TTL', async () => {
    lease.start();
    await settle();

    await lease.stop();

    expect(syncLock.release).toHaveBeenCalledWith('singleton:scheduler', 'tok-1');
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(lease.isHolding()).toBe(false);
  });

  it('releases and re-competes when onAcquired throws, rather than holding a lease it cannot serve', async () => {
    onAcquired.mockImplementation(() => {
      throw new Error('scheduler start failed');
    });

    lease.start();
    await settle();

    expect(syncLock.release).toHaveBeenCalledWith('singleton:scheduler', 'tok-1');
    expect(lease.isHolding()).toBe(false);
    // The owner must learn the responsibility is NOT running, or its own
    // idempotency latch stays set and the next acquisition silently no-ops.
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('releases instead of starting when stop() races an in-flight acquire', async () => {
    let releaseAcquire: (token: string | null) => void = () => undefined;
    syncLock.acquire.mockImplementation(
      () => new Promise((resolve) => { releaseAcquire = resolve; })
    );

    lease.start();
    await settle();
    // Shutdown lands while Redis is still answering the acquire.
    await lease.stop();
    releaseAcquire('tok-late');
    await settle();

    // Starting here would run the responsibility during teardown and strand
    // the lock for a full TTL with nothing left to extend or release it.
    expect(onAcquired).not.toHaveBeenCalled();
    expect(lease.isHolding()).toBe(false);
    expect(syncLock.release).toHaveBeenCalledWith('singleton:scheduler', 'tok-late');
  });

  describe('heartbeat ticks', () => {
    beforeEach(() => {
      // `setImmediate` stays real so a test can flush the async tick body
      // between timer advances; only the interval itself is faked.
      jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    /** Let a tick's async body run to completion. */
    const settleTick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

    /** Advance one tick interval (TTL/3) and let its async body settle. */
    async function advanceOneTick(): Promise<void> {
      jest.advanceTimersByTime(20_000);
      await settleTick();
    }

    it('extends a held lease instead of re-acquiring it', async () => {
      lease.start();
      await settleTick();
      await advanceOneTick();

      expect(syncLock.extend).toHaveBeenCalledWith('singleton:scheduler', 'tok-1', 60_000);
      expect(syncLock.acquire).toHaveBeenCalledTimes(1);
    });

    it('treats extend === false as lease loss: onLost fires once and it competes again', async () => {
      lease.start();
      await settleTick();
      syncLock.extend.mockResolvedValue(false);

      await advanceOneTick();

      expect(onLost).toHaveBeenCalledTimes(1);
      expect(lease.isHolding()).toBe(false);

      // Next tick competes again rather than extending a token it no longer owns.
      await advanceOneTick();
      expect(syncLock.acquire).toHaveBeenCalledTimes(2);
    });

    it('does NOT treat a Redis throw while holding as loss — the lock is still there', async () => {
      lease.start();
      await settleTick();
      syncLock.extend.mockRejectedValue(new Error('redis blip'));

      await advanceOneTick();

      expect(onLost).not.toHaveBeenCalled();
      expect(lease.isHolding()).toBe(true);
    });

    it('self-demotes once the hold has gone unconfirmed for a full TTL (the partition case)', async () => {
      lease.start();
      await settleTick();
      syncLock.extend.mockRejectedValue(new Error('partitioned from redis'));

      // Three consecutive failed extends ≈ one TTL at a TTL/3 cadence: past
      // that instant the lock has provably expired in Redis and a peer may
      // legitimately hold it, so continuing to act as holder is a claim this
      // process cannot support.
      await advanceOneTick();
      await advanceOneTick();
      expect(lease.isHolding()).toBe(true);

      await advanceOneTick();

      expect(onLost).toHaveBeenCalledTimes(1);
      expect(lease.isHolding()).toBe(false);
    });

    it('keeps holding indefinitely while extends keep succeeding', async () => {
      lease.start();
      await settleTick();

      for (let i = 0; i < 10; i += 1) {
        await advanceOneTick();
      }

      expect(onLost).not.toHaveBeenCalled();
      expect(lease.isHolding()).toBe(true);
    });
  });
});
