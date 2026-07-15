/**
 * KSeF Rate Limiter (#1594)
 *
 * Proactive, client-side token-bucket pacer for the three rate-limited KSeF
 * online-session write endpoints. KSeF 2.0 enforces per-context
 * `(seller NIP, source IP)` per-hour ceilings:
 *   - `POST /sessions/online`            (session-open)   = 120/hour
 *   - `POST /sessions/online/{ref}/invoices` (invoice-submit) = 180/hour
 *   - `POST /sessions/online/{ref}/close`    (session-close)  = 120/hour
 *
 * A 100-order bulk-issue run fans out to ~100 opens + 100 submits + 100 closes
 * on ONE connection, landing within a few points of the open/close ceiling and
 * leaving no headroom for auto-issue / retries / a second bulk call in the same
 * rolling hour. This limiter self-throttles that run against the documented
 * ceilings so the reactive 429/Retry-After path (which only fires AFTER KSeF
 * rejects) becomes a backstop rather than the primary control.
 *
 * Design:
 *  - One token bucket per `(bucketKey, category)`. `bucketKey` is the seller NIP
 *    (KSeF buckets by NIP), so multiple OL connections on the same NIP + the
 *    same egress IP share one bucket — matching KSeF's own edge accounting.
 *    A single OL deployment egresses from one IP, so keying on NIP alone is a
 *    faithful proxy for KSeF's `(NIP, IP)` context here.
 *  - Bucket capacity == `perHour`; refill accrues continuously at
 *    `perHour / 3_600_000` tokens per ms. A burst up to `perHour` is admitted
 *    immediately; steady-state then paces at the sustained rate.
 *  - `acquire` consumes one token, awaiting (via the injected clock) until a
 *    token is available. The injected clock keeps the pacer testable with a fake
 *    time source — no real sleeps in specs.
 *
 * This is a process-local pacer (a shared singleton via
 * `getSharedKsefRateLimiter`), NOT a cross-process/distributed limiter: it
 * bounds THIS deployment's own outbound rate. Cross-instance coordination (if OL
 * ever runs multiple issuing replicas against one NIP) is a documented follow-up.
 *
 * @module libs/integrations/ksef/src/infrastructure/http
 */
import { Logger } from '@openlinker/shared/logging';
import type {
  KsefRateLimitCategory,
  KsefRateLimiterClock,
  KsefRateLimiterConfig,
} from './ksef-rate-limiter.types';

const MS_PER_HOUR = 3_600_000;

/**
 * Absorbs IEEE-754 drift when a refill computes a token count a hair below a
 * whole token (e.g. 0.9999999 instead of 1). Without it a bucket that has
 * mathematically accrued exactly one token would spin one extra 1ms wait.
 */
const TOKEN_EPSILON = 1e-6;

/**
 * Documented KSeF per-hour ceilings (per `(NIP, IP)` context). Re-confirm
 * against the live CIRFMF documentation periodically — MF may adjust these.
 */
export const KSEF_DOCUMENTED_CEILINGS: Record<KsefRateLimitCategory, number> = {
  'session-open': 120,
  'invoice-submit': 180,
  'session-close': 120,
};

/**
 * Fraction of each documented ceiling the pacer will actually spend, reserving
 * the remainder as headroom for concurrent activity (auto-issue trigger, manual
 * retries, a second bulk call) on the same context. 0.9 keeps a 100-order bulk
 * run well under the burst capacity (0.9 * 120 = 108 > 100) while still leaving
 * ~10% for everything else.
 */
export const DEFAULT_KSEF_UTILIZATION_FACTOR = 0.9;

/** Build the default limiter config from the documented ceilings + headroom factor. */
export function buildDefaultKsefRateLimiterConfig(
  utilizationFactor: number = DEFAULT_KSEF_UTILIZATION_FACTOR,
): KsefRateLimiterConfig {
  const scale = (ceiling: number): number => Math.max(1, Math.floor(ceiling * utilizationFactor));
  return {
    'session-open': { perHour: scale(KSEF_DOCUMENTED_CEILINGS['session-open']) },
    'invoice-submit': { perHour: scale(KSEF_DOCUMENTED_CEILINGS['invoice-submit']) },
    'session-close': { perHour: scale(KSEF_DOCUMENTED_CEILINGS['session-close']) },
  };
}

/** Default clock: real wall-clock time + real (cancellable-free) sleep. */
const REAL_CLOCK: KsefRateLimiterClock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

interface TokenBucket {
  tokens: number;
  lastRefillMs: number;
}

export class KsefRateLimiter {
  private readonly logger = new Logger(KsefRateLimiter.name);
  private readonly config: KsefRateLimiterConfig;
  private readonly clock: KsefRateLimiterClock;
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(config?: Partial<KsefRateLimiterConfig>, clock: KsefRateLimiterClock = REAL_CLOCK) {
    this.config = { ...buildDefaultKsefRateLimiterConfig(), ...config };
    this.clock = clock;
  }

  /**
   * Consume one token for `(bucketKey, category)`, awaiting until one is
   * available. Serialises acquisitions per bucket so concurrent callers can't
   * both read the same pre-refill token count and over-draw the bucket.
   */
  async acquire(bucketKey: string, category: KsefRateLimitCategory): Promise<void> {
    const perHour = this.config[category]?.perHour;
    if (!perHour || perHour <= 0) {
      return; // Unconfigured / disabled category — no pacing.
    }
    const refillPerMs = perHour / MS_PER_HOUR;
    const key = `${bucketKey}:${category}`;

    for (;;) {
      const bucket = this.getBucket(key, perHour);
      this.refill(bucket, perHour, refillPerMs);
      if (bucket.tokens + TOKEN_EPSILON >= 1) {
        bucket.tokens = Math.max(0, bucket.tokens - 1);
        return;
      }
      // Not enough credit yet — wait for exactly one token to accrue, then loop
      // and re-check (another waiter may have consumed it first).
      // Compute via `perHour` (not `refillPerMs`) so the tiny divisor doesn't
      // amplify float error into a spurious extra millisecond of wait.
      const waitMs = Math.ceil(((1 - bucket.tokens) * MS_PER_HOUR) / perHour);
      this.logger.debug(
        `Pacing KSeF ${category} on bucket ${bucketKey}: waiting ${waitMs}ms for a rate-limit token`,
      );
      await this.clock.sleep(waitMs);
    }
  }

  private getBucket(key: string, capacity: number): TokenBucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      // Start full: the first burst up to the ceiling is admitted immediately.
      bucket = { tokens: capacity, lastRefillMs: this.clock.now() };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private refill(bucket: TokenBucket, capacity: number, refillPerMs: number): void {
    const now = this.clock.now();
    const elapsed = now - bucket.lastRefillMs;
    if (elapsed <= 0) {
      return;
    }
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
    bucket.lastRefillMs = now;
  }
}

let sharedInstance: KsefRateLimiter | null = null;

/**
 * Process-wide shared limiter so every per-connection KSeF HTTP client paces
 * against the SAME buckets — the point of keying on NIP is defeated if each
 * short-lived adapter instance got its own limiter. Constructed lazily with the
 * default (documented-ceiling) config; tests construct their own instance
 * directly rather than touching this singleton.
 */
export function getSharedKsefRateLimiter(): KsefRateLimiter {
  if (!sharedInstance) {
    sharedInstance = new KsefRateLimiter();
  }
  return sharedInstance;
}
