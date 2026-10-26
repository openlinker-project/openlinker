/**
 * KSeF Rate Limiter unit specs (#1594, DEF-04 / DEF-05 / DEF-06)
 *
 * Exercises the rolling-hour pacer under a SIMULATED ceiling using an injected
 * fake clock whose `sleep` advances virtual time — so pacing is asserted
 * deterministically with zero real waiting.
 */
import {
  KsefRateLimiter,
  buildDefaultKsefRateLimiterConfig,
  getSharedKsefRateLimiter,
  KSEF_DOCUMENTED_CEILINGS,
  DEFAULT_KSEF_UTILIZATION_FACTOR,
  KSEF_SESSION_ROUND,
} from '../ksef-rate-limiter';
import { KsefRateLimitDeferredException } from '../../../domain/exceptions/ksef-rate-limit-deferred.exception';
import type { KsefRateLimiterClock, KsefRateLimitStore } from '../ksef-rate-limiter.types';

/** Virtual clock: `sleep` fast-forwards `now`. */
class FakeClock implements KsefRateLimiterClock {
  private t = 0;
  now(): number {
    return this.t;
  }
  sleep(ms: number): Promise<void> {
    this.t += ms;
    return Promise.resolve();
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

const MS_PER_HOUR = 3_600_000;
const UNBOUNDED = { maxWaitMs: Number.POSITIVE_INFINITY };

describe('KsefRateLimiter', () => {
  it('admits up to the ceiling with no wait', async () => {
    const clock = new FakeClock();
    const limiter = new KsefRateLimiter({ 'session-open': { perHour: 3 } }, clock);

    for (let i = 0; i < 3; i++) {
      await limiter.acquire('nip-1', 'session-open');
    }

    expect(clock.now()).toBe(0);
  });

  it('waits until the oldest request leaves the rolling hour', async () => {
    const clock = new FakeClock();
    const limiter = new KsefRateLimiter({ 'session-open': { perHour: 2 } }, clock);

    await limiter.reserve('nip-1', ['session-open'], UNBOUNDED);
    clock.advance(1_000);
    await limiter.reserve('nip-1', ['session-open'], UNBOUNDED);
    await limiter.reserve('nip-1', ['session-open'], UNBOUNDED);

    // The third request is admitted the moment the first (t=0) is an hour old.
    expect(clock.now()).toBe(MS_PER_HOUR);
  });

  it('never admits more than the ceiling in any rolling hour (DEF-05)', async () => {
    const clock = new FakeClock();
    const perHour = 108;
    const limiter = new KsefRateLimiter({ 'session-open': { perHour } }, clock);
    const admittedAt: number[] = [];

    for (let i = 0; i < 300; i++) {
      await limiter.reserve('nip-1', ['session-open'], UNBOUNDED);
      admittedAt.push(clock.now());
      clock.advance(12_000); // one attempt every 12 s for an hour
    }

    for (const start of admittedAt) {
      const inWindow = admittedAt.filter((t) => t >= start && t < start + MS_PER_HOUR).length;
      expect(inWindow).toBeLessThanOrEqual(perHour);
    }
  });

  it('reserves a whole session round or nothing', async () => {
    const clock = new FakeClock();
    const limiter = new KsefRateLimiter(
      {
        'session-open': { perHour: 5 },
        'invoice-submit': { perHour: 1 },
        'session-close': { perHour: 5 },
      },
      clock,
    );

    await limiter.reserve('nip-1', KSEF_SESSION_ROUND);
    const second = await limiter.reserve('nip-1', KSEF_SESSION_ROUND).catch((e: unknown) => e);

    expect(second).toBeInstanceOf(KsefRateLimitDeferredException);
    // The refused round must not have consumed an open: four more opens fit.
    for (let i = 0; i < 4; i++) {
      await limiter.reserve('nip-1', ['session-open']);
    }
    expect(clock.now()).toBe(0);
  });

  it('defers instead of waiting past the allowed budget (DEF-04)', async () => {
    const clock = new FakeClock();
    const limiter = new KsefRateLimiter({ 'session-open': { perHour: 1 } }, clock);

    await limiter.reserve('nip-1', ['session-open']);
    const error = await limiter
      .reserve('nip-1', ['session-open'], { maxWaitMs: 20_000 })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KsefRateLimitDeferredException);
    expect((error as KsefRateLimitDeferredException).retryAfterMs).toBe(MS_PER_HOUR);
    expect((error as KsefRateLimitDeferredException).failureMode).toBe('rejected');
    // It gave up without sleeping at all.
    expect(clock.now()).toBe(0);
  });

  it('keeps categories and bucket keys independent', async () => {
    const clock = new FakeClock();
    const limiter = new KsefRateLimiter(
      { 'session-open': { perHour: 1 }, 'invoice-submit': { perHour: 1 } },
      clock,
    );

    await limiter.acquire('nip-A', 'session-open');
    await limiter.acquire('nip-A', 'invoice-submit');
    await limiter.acquire('nip-B', 'session-open');

    expect(clock.now()).toBe(0);
  });

  it('does not pace a category configured to a non-positive ceiling', async () => {
    const clock = new FakeClock();
    const limiter = new KsefRateLimiter({ 'session-close': { perHour: 0 } }, clock);

    for (let i = 0; i < 50; i++) {
      await limiter.acquire('nip-1', 'session-close');
    }
    expect(clock.now()).toBe(0);
  });

  it('uses a swapped-in shared store (DEF-06)', async () => {
    const clock = new FakeClock();
    const store: KsefRateLimitStore = {
      tryReserve: jest.fn().mockResolvedValue({ admitted: true }),
    };
    const limiter = new KsefRateLimiter(undefined, clock);
    limiter.useStore(store);

    await limiter.reserve('test:1189981779', KSEF_SESSION_ROUND);

    expect(store.tryReserve).toHaveBeenCalledWith(
      'test:1189981779',
      expect.arrayContaining([expect.objectContaining({ category: 'session-open' })]),
      MS_PER_HOUR,
    );
  });

  it('falls back to its own log when the shared store throws', async () => {
    const clock = new FakeClock();
    const store: KsefRateLimitStore = {
      tryReserve: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const limiter = new KsefRateLimiter({ 'session-open': { perHour: 1 } }, clock, store);

    await expect(limiter.reserve('nip-1', ['session-open'])).resolves.toBeUndefined();
    await expect(limiter.reserve('nip-1', ['session-open'])).rejects.toBeInstanceOf(
      KsefRateLimitDeferredException,
    );
  });

  describe('default config', () => {
    it('scales documented ceilings by the headroom factor', () => {
      const cfg = buildDefaultKsefRateLimiterConfig();
      expect(cfg['session-open'].perHour).toBe(
        Math.floor(KSEF_DOCUMENTED_CEILINGS['session-open'] * DEFAULT_KSEF_UTILIZATION_FACTOR),
      );
      expect(cfg['invoice-submit'].perHour).toBe(
        Math.floor(KSEF_DOCUMENTED_CEILINGS['invoice-submit'] * DEFAULT_KSEF_UTILIZATION_FACTOR),
      );
      expect(cfg['session-open'].perHour).toBeGreaterThan(100);
    });
  });

  describe('getSharedKsefRateLimiter', () => {
    it('returns a stable process-wide singleton', () => {
      expect(getSharedKsefRateLimiter()).toBe(getSharedKsefRateLimiter());
    });
  });
});
