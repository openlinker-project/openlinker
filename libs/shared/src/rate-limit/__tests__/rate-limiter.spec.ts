/**
 * Rate Limiter Unit Tests
 *
 * All timing is driven by an injectable clock plus jest fake timers — zero
 * real wait time, per the acceptance criteria in the #1810 implementation
 * plan.
 *
 * @module libs/shared/src/rate-limit
 */
import { RateLimiter, MAX_TOTAL_WAIT_MS } from '../rate-limiter';
import { RateLimitAbortedError, RateLimitTimeoutError } from '../rate-limiter.errors';

describe('RateLimiter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('spacing (minimum-interval, not a bursty bucket)', () => {
    it('does not burst — a cold limiter at 60/min spaces requests ~1s apart, not instantly', async () => {
      let nowMs = 0;
      const limiter = new RateLimiter({ requestsPerMinute: 60 }, { now: (): number => nowMs });

      const release1 = await limiter.acquire({ requestsPerMinute: 60 });
      release1();

      let secondResolved = false;
      const secondPromise = limiter.acquire({ requestsPerMinute: 60 }).then((release) => {
        secondResolved = true;
        release();
      });

      // Immediately after the first acquire, a second must NOT resolve yet.
      await Promise.resolve();
      expect(secondResolved).toBe(false);

      // Advance the clock and timers together to just short of the 1000ms interval.
      nowMs += 900;
      jest.advanceTimersByTime(900);
      await Promise.resolve();
      expect(secondResolved).toBe(false);

      // Advance past the interval — the queued acquire should now resolve.
      nowMs += 200;
      jest.advanceTimersByTime(200);
      await secondPromise;
      expect(secondResolved).toBe(true);
    });

    it('re-reads the live policy on every acquire — lowering the cap takes effect without a restart', async () => {
      let nowMs = 0;
      const limiter = new RateLimiter({ requestsPerMinute: 6000 }, { now: (): number => nowMs });

      const release = await limiter.acquire({ requestsPerMinute: 6000 });
      release();

      expect(limiter.getStatus().requestsPerMinute).toBe(6000);

      // Past the first acquire's ~10ms spacing interval, so the second
      // acquire isn't gated by leftover state from the old, higher cap.
      nowMs += 10;
      jest.advanceTimersByTime(10);

      const releaseAfterLower = await limiter.acquire({ requestsPerMinute: 30 });
      releaseAfterLower();

      expect(limiter.getStatus().requestsPerMinute).toBe(30);
    });
  });

  describe('concurrency cap', () => {
    it('releases the concurrency slot on throw (release must be called in a finally by the caller)', async () => {
      const limiter = new RateLimiter({ maxConcurrent: 1 });

      const release1 = await limiter.acquire({ maxConcurrent: 1 });
      expect(limiter.getStatus().inFlight).toBe(1);

      let secondAcquired = false;
      const secondPromise = limiter.acquire({ maxConcurrent: 1 }).then((release2) => {
        secondAcquired = true;
        return release2;
      });

      await Promise.resolve();
      expect(secondAcquired).toBe(false);

      // Simulate the first caller's request throwing — it still releases.
      try {
        throw new Error('boom');
      } catch {
        release1();
      }

      const release2 = await secondPromise;
      expect(secondAcquired).toBe(true);
      release2();
      expect(limiter.getStatus().inFlight).toBe(0);
    });

    it('does not exceed maxConcurrent under concurrent acquires', async () => {
      const limiter = new RateLimiter({ maxConcurrent: 2 });

      const p1 = limiter.acquire({ maxConcurrent: 2 });
      const p2 = limiter.acquire({ maxConcurrent: 2 });
      const p3 = limiter.acquire({ maxConcurrent: 2 });

      const release1 = await p1;
      const release2 = await p2;
      expect(limiter.getStatus().inFlight).toBe(2);

      let thirdResolved = false;
      void p3.then(() => {
        thirdResolved = true;
      });
      await Promise.resolve();
      expect(thirdResolved).toBe(false);

      release1();
      const release3 = await p3;
      expect(thirdResolved).toBe(true);
      release2();
      release3();
    });
  });

  describe('priority — interactive not starved by background', () => {
    it('drains a later interactive waiter ahead of an earlier-queued background one', async () => {
      const limiter = new RateLimiter({ maxConcurrent: 1 });

      const release1 = await limiter.acquire({ maxConcurrent: 1 });

      const order: string[] = [];
      const backgroundPromise = limiter
        .acquire({ maxConcurrent: 1 }, 'background')
        .then((release) => {
          order.push('background');
          return release;
        });
      await Promise.resolve();

      const interactivePromise = limiter
        .acquire({ maxConcurrent: 1 }, 'interactive')
        .then((release) => {
          order.push('interactive');
          return release;
        });
      await Promise.resolve();

      release1();
      const releaseInteractive = await interactivePromise;
      expect(order).toEqual(['interactive']);

      releaseInteractive();
      const releaseBackground = await backgroundPromise;
      expect(order).toEqual(['interactive', 'background']);
      releaseBackground();
    });
  });

  describe('timeout bound', () => {
    it('rejects with RateLimitTimeoutError once MAX_TOTAL_WAIT_MS elapses while queued', async () => {
      const limiter = new RateLimiter({ maxConcurrent: 1 });
      const release1 = await limiter.acquire({ maxConcurrent: 1 });

      const queuedPromise = limiter.acquire({ maxConcurrent: 1 });
      const assertion = expect(queuedPromise).rejects.toBeInstanceOf(RateLimitTimeoutError);

      jest.advanceTimersByTime(MAX_TOTAL_WAIT_MS + 1);
      await assertion;

      release1();
    });

    it('removes the abort listener on timeout — a signal-bearing waiter must not leak its listener', async () => {
      const limiter = new RateLimiter({ maxConcurrent: 1 });
      const release1 = await limiter.acquire({ maxConcurrent: 1 });

      const controller = new AbortController();
      const removeSpy = jest.spyOn(controller.signal, 'removeEventListener');

      const queuedPromise = limiter.acquire({ maxConcurrent: 1 }, 'background', controller.signal);
      const assertion = expect(queuedPromise).rejects.toBeInstanceOf(RateLimitTimeoutError);

      jest.advanceTimersByTime(MAX_TOTAL_WAIT_MS + 1);
      await assertion;

      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));

      release1();
    });
  });

  describe('abort', () => {
    it('cancels a queued wait with RateLimitAbortedError when the signal aborts', async () => {
      const limiter = new RateLimiter({ maxConcurrent: 1 });
      const release1 = await limiter.acquire({ maxConcurrent: 1 });

      const controller = new AbortController();
      const queuedPromise = limiter.acquire({ maxConcurrent: 1 }, 'background', controller.signal);
      const assertion = expect(queuedPromise).rejects.toBeInstanceOf(RateLimitAbortedError);

      controller.abort();
      await assertion;

      release1();
    });

    it('rejects immediately with RateLimitAbortedError when the signal is already aborted', async () => {
      const limiter = new RateLimiter({});
      const controller = new AbortController();
      controller.abort();

      await expect(limiter.acquire({}, 'background', controller.signal)).rejects.toBeInstanceOf(
        RateLimitAbortedError
      );
    });
  });

  describe('unset policy stays unset', () => {
    it('never blocks when neither requestsPerMinute nor maxConcurrent is set', async () => {
      const limiter = new RateLimiter({});
      const releases = await Promise.all([
        limiter.acquire({}),
        limiter.acquire({}),
        limiter.acquire({}),
      ]);
      expect(limiter.getStatus().inFlight).toBe(3);
      releases.forEach((release) => release());
    });
  });

  describe('release idempotency', () => {
    it('calling release twice does not double-decrement inFlight', async () => {
      const limiter = new RateLimiter({ maxConcurrent: 1 });
      const release = await limiter.acquire({ maxConcurrent: 1 });
      release();
      release();
      expect(limiter.getStatus().inFlight).toBe(0);
    });
  });

  describe('noteRetryAfter', () => {
    it('pushes the next-available time forward, delaying the following acquire', async () => {
      let nowMs = 0;
      const limiter = new RateLimiter({ requestsPerMinute: 60 }, { now: (): number => nowMs });

      const release1 = await limiter.acquire({ requestsPerMinute: 60 });
      release1();

      limiter.noteRetryAfter(5000);

      let resolved = false;
      const p = limiter.acquire({ requestsPerMinute: 60 }).then((release) => {
        resolved = true;
        release();
      });

      nowMs += 1000; // past the ordinary 1s spacing interval
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(resolved).toBe(false); // still gated by the Retry-After push

      nowMs += 4000;
      jest.advanceTimersByTime(4000);
      await p;
      expect(resolved).toBe(true);
    });

    it('is honoured even when the policy configures only maxConcurrent (no requestsPerMinute)', async () => {
      let nowMs = 0;
      const limiter = new RateLimiter({ maxConcurrent: 1 }, { now: (): number => nowMs });

      const release1 = await limiter.acquire({ maxConcurrent: 1 });
      release1();

      limiter.noteRetryAfter(5000);

      let resolved = false;
      const p = limiter.acquire({ maxConcurrent: 1 }).then((release) => {
        resolved = true;
        release();
      });

      // A slot is free (inFlight back to 0 after release1()) and there is
      // no requestsPerMinute spacing to wait on — without the fix, drain()
      // never consults nextAvailableAt for a maxConcurrent-only policy, so
      // this would resolve immediately instead of waiting out the
      // Retry-After push.
      await Promise.resolve();
      expect(resolved).toBe(false); // still gated by the Retry-After push

      nowMs += 5000;
      jest.advanceTimersByTime(5000);
      await p;
      expect(resolved).toBe(true);
    });
  });
});
