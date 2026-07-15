/**
 * KSeF Rate Limiter unit specs (#1594)
 *
 * Exercises the token-bucket pacer under a SIMULATED rate-limit ceiling using an
 * injected fake clock whose `sleep` advances virtual time — so pacing is
 * asserted deterministically with zero real waiting.
 */
import {
  KsefRateLimiter,
  buildDefaultKsefRateLimiterConfig,
  getSharedKsefRateLimiter,
  KSEF_DOCUMENTED_CEILINGS,
  DEFAULT_KSEF_UTILIZATION_FACTOR,
} from '../ksef-rate-limiter';
import type { KsefRateLimiterClock } from '../ksef-rate-limiter.types';

/** Virtual clock: `sleep` fast-forwards `now`, so refill accrues without real time. */
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

describe('KsefRateLimiter', () => {
  it('admits a burst up to the configured ceiling with no wait', async () => {
    const clock = new FakeClock();
    const limiter = new KsefRateLimiter({ 'session-open': { perHour: 3 } }, clock);

    await limiter.acquire('nip-1', 'session-open');
    await limiter.acquire('nip-1', 'session-open');
    await limiter.acquire('nip-1', 'session-open');

    // Bucket started full (capacity 3) → three immediate grants, no time passed.
    expect(clock.now()).toBe(0);
  });

  it('paces the next request once the burst capacity is exhausted', async () => {
    const clock = new FakeClock();
    const limiter = new KsefRateLimiter({ 'session-open': { perHour: 2 } }, clock);

    await limiter.acquire('nip-1', 'session-open'); // 2 -> 1
    await limiter.acquire('nip-1', 'session-open'); // 1 -> 0
    expect(clock.now()).toBe(0);

    await limiter.acquire('nip-1', 'session-open'); // waits for 1 token
    // One token accrues in perHour^-1 of an hour: 3_600_000 / 2 = 1_800_000 ms.
    expect(clock.now()).toBe(MS_PER_HOUR / 2);
  });

  it('paces a bulk run of N requests under a low ceiling', async () => {
    const clock = new FakeClock();
    const ceiling = 5;
    const limiter = new KsefRateLimiter({ 'invoice-submit': { perHour: ceiling } }, clock);

    const total = 8; // 5 burst + 3 paced
    for (let i = 0; i < total; i++) {
      await limiter.acquire('nip-bulk', 'invoice-submit');
    }

    // After the initial `ceiling` burst, each further grant costs one refill
    // interval (MS_PER_HOUR / ceiling). 3 paced grants → 3 intervals of elapsed
    // virtual time.
    const pacedGrants = total - ceiling;
    expect(clock.now()).toBe(pacedGrants * (MS_PER_HOUR / ceiling));
  });

  it('keeps categories independent (one exhausted bucket never blocks another)', async () => {
    const clock = new FakeClock();
    const limiter = new KsefRateLimiter(
      { 'session-open': { perHour: 1 }, 'invoice-submit': { perHour: 1 } },
      clock,
    );

    await limiter.acquire('nip-1', 'session-open'); // drains session-open
    await limiter.acquire('nip-1', 'invoice-submit'); // independent bucket, immediate

    expect(clock.now()).toBe(0);
  });

  it('keeps bucket keys (seller NIPs) independent', async () => {
    const clock = new FakeClock();
    const limiter = new KsefRateLimiter({ 'session-open': { perHour: 1 } }, clock);

    await limiter.acquire('nip-A', 'session-open'); // drains A
    await limiter.acquire('nip-B', 'session-open'); // separate bucket, immediate

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

  it('refills continuously so waiting real time restores tokens', async () => {
    const clock = new FakeClock();
    const limiter = new KsefRateLimiter({ 'session-open': { perHour: 2 } }, clock);

    await limiter.acquire('nip-1', 'session-open'); // 2 -> 1
    await limiter.acquire('nip-1', 'session-open'); // 1 -> 0

    // Advance a full refill interval out-of-band → one token should be back.
    clock.advance(MS_PER_HOUR / 2);
    await limiter.acquire('nip-1', 'session-open'); // consumes the refilled token, no wait
    expect(clock.now()).toBe(MS_PER_HOUR / 2);
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
      // 0.9 * 120 = 108 > 100 (max bulk batch), so a full 100-order batch still
      // bursts through without pacing while reserving ~10% headroom.
      expect(cfg['session-open'].perHour).toBeGreaterThan(100);
    });
  });

  describe('getSharedKsefRateLimiter', () => {
    it('returns a stable process-wide singleton', () => {
      expect(getSharedKsefRateLimiter()).toBe(getSharedKsefRateLimiter());
    });
  });
});
