/**
 * KSeF Rate Limiter (#1594, DEF-04 / DEF-05 / DEF-06)
 *
 * Proactive, client-side pacer for the three rate-limited KSeF online-session
 * write endpoints. KSeF 2.0 enforces per-context `(seller NIP, source IP)`
 * per-hour ceilings:
 *   - `POST /sessions/online`                (session-open)   = 120/hour
 *   - `POST /sessions/online/{ref}/invoices` (invoice-submit) = 180/hour
 *   - `POST /sessions/online/{ref}/close`    (session-close)  = 120/hour
 *
 * A 100-order bulk-issue run fans out to ~100 opens + 100 submits + 100 closes
 * on ONE connection. This limiter self-throttles such a run against the
 * documented ceilings so the reactive 429/Retry-After path becomes a backstop
 * rather than the primary control.
 *
 * Three properties are load-bearing:
 *  - **A rolling-hour log, not a token bucket (DEF-05).** A request is admitted
 *    only while fewer than `perHour` were admitted in the last hour. The bucket
 *    it replaces started full and kept refilling, so it admitted ~2x the ceiling
 *    in its first hour. See `ksef-rate-limit-stores.ts`.
 *  - **One budget for every process (DEF-06).** The store is swappable: the
 *    module wires the Redis store when Redis is available, so the api and every
 *    worker replica count against the same log KSeF counts against. When Redis
 *    cannot answer, the limiter falls back to its in-process log and says so in
 *    the log, rather than failing an issuance over its own bookkeeping.
 *  - **A bounded wait, decided before the session opens (DEF-04).** `reserve`
 *    takes every token a round needs (open + submit + close) at once and waits
 *    at most `maxWaitMs` for them. If the budget will not free up in time it
 *    throws {@link KsefRateLimitDeferredException} instead of sleeping past the
 *    fiscal issuing lease; nothing has been sent at that point, so the job can
 *    be requeued without spending an attempt.
 *
 * `bucketKey` is `{env}:{seller NIP}`: KSeF buckets by NIP, per environment.
 *
 * @module libs/integrations/ksef/src/infrastructure/http
 */
import { Logger } from '@openlinker/shared/logging';
import { KsefRateLimitDeferredException } from '../../domain/exceptions/ksef-rate-limit-deferred.exception';
import { InMemoryKsefRateLimitStore } from './ksef-rate-limit-stores';
import type {
  KsefRateLimitCategory,
  KsefRateLimitDemand,
  KsefRateLimiterClock,
  KsefRateLimiterConfig,
  KsefRateLimitStore,
} from './ksef-rate-limiter.types';

export const KSEF_RATE_LIMIT_WINDOW_MS = 3_600_000;

/**
 * Longest a single issuance waits for budget before deferring (DEF-04). Kept
 * well inside the core's supported provider round-trip so that pacing, the NBP
 * read and the KSeF calls together stay under the issuing lease.
 */
export const KSEF_MAX_PACING_WAIT_MS = 20_000;

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
 * the remainder as headroom for activity OpenLinker does not see on the same
 * context (another tool using the same token, for one).
 */
export const DEFAULT_KSEF_UTILIZATION_FACTOR = 0.9;

/** The three calls one online-session issuance makes, in order. */
export const KSEF_SESSION_ROUND: readonly KsefRateLimitCategory[] = [
  'session-open',
  'invoice-submit',
  'session-close',
];

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

/** Default clock: real wall-clock time + real sleep. */
const REAL_CLOCK: KsefRateLimiterClock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface KsefReserveOptions {
  /** Longest to wait for budget; defaults to {@link KSEF_MAX_PACING_WAIT_MS}. */
  maxWaitMs?: number;
}

export class KsefRateLimiter {
  private readonly logger = new Logger(KsefRateLimiter.name);
  private readonly config: KsefRateLimiterConfig;
  private readonly clock: KsefRateLimiterClock;
  private readonly fallback: InMemoryKsefRateLimitStore;
  private store: KsefRateLimitStore;

  constructor(
    config?: Partial<KsefRateLimiterConfig>,
    clock: KsefRateLimiterClock = REAL_CLOCK,
    store?: KsefRateLimitStore,
  ) {
    this.config = { ...buildDefaultKsefRateLimiterConfig(), ...config };
    this.clock = clock;
    this.fallback = new InMemoryKsefRateLimitStore(() => this.clock.now());
    this.store = store ?? this.fallback;
  }

  /** Swap the store (the module wires Redis once the host provides it). */
  useStore(store: KsefRateLimitStore): void {
    this.store = store;
  }

  /**
   * Reserve every category in `categories` for `bucketKey`, all or none,
   * waiting at most `maxWaitMs`. Throws {@link KsefRateLimitDeferredException}
   * when the budget would not free up in time.
   */
  async reserve(
    bucketKey: string,
    categories: readonly KsefRateLimitCategory[],
    options: KsefReserveOptions = {},
  ): Promise<void> {
    const demands = this.demandsFor(categories);
    if (demands.length === 0) {
      return;
    }
    const maxWaitMs = options.maxWaitMs ?? KSEF_MAX_PACING_WAIT_MS;
    const started = this.clock.now();

    for (;;) {
      const outcome = await this.tryReserve(bucketKey, demands);
      if (outcome.admitted) {
        return;
      }
      const waited = this.clock.now() - started;
      if (waited + outcome.retryAfterMs > maxWaitMs) {
        throw new KsefRateLimitDeferredException(bucketKey, outcome.retryAfterMs);
      }
      this.logger.debug(
        `Pacing KSeF ${categories.join('+')} on bucket ${bucketKey}: waiting ${outcome.retryAfterMs}ms`,
      );
      await this.clock.sleep(outcome.retryAfterMs);
    }
  }

  /** Reserve one category; the path for a call that was not reserved as a round. */
  acquire(bucketKey: string, category: KsefRateLimitCategory): Promise<void> {
    return this.reserve(bucketKey, [category]);
  }

  private demandsFor(categories: readonly KsefRateLimitCategory[]): KsefRateLimitDemand[] {
    return categories
      .map((category) => ({ category, perHour: this.config[category]?.perHour ?? 0 }))
      .filter((demand) => demand.perHour > 0);
  }

  private async tryReserve(
    bucketKey: string,
    demands: readonly KsefRateLimitDemand[],
  ): ReturnType<KsefRateLimitStore['tryReserve']> {
    if (this.store === this.fallback) {
      return this.fallback.tryReserve(bucketKey, demands, KSEF_RATE_LIMIT_WINDOW_MS);
    }
    try {
      return await this.store.tryReserve(bucketKey, demands, KSEF_RATE_LIMIT_WINDOW_MS);
    } catch (error) {
      this.logger.warn(
        `Shared KSeF rate-limit store unavailable, pacing this process only: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.fallback.tryReserve(bucketKey, demands, KSEF_RATE_LIMIT_WINDOW_MS);
    }
  }
}

let sharedInstance: KsefRateLimiter | null = null;

/**
 * Process-wide shared limiter so every per-connection KSeF HTTP client paces
 * against the SAME log — keying on NIP is pointless if each short-lived
 * adapter instance got its own limiter. Tests construct their own instance.
 */
export function getSharedKsefRateLimiter(): KsefRateLimiter {
  if (!sharedInstance) {
    sharedInstance = new KsefRateLimiter();
  }
  return sharedInstance;
}
