/**
 * Redis Rate Limiter Adapter
 *
 * Redis-backed `RateLimiterPort` so `apps/api` and `apps/worker` — two
 * independent Node processes — throttle the same connection's outbound
 * traffic against one shared bucket instead of two independent in-memory
 * pools (#2015, ADR-038 "Cross-process coordination" follow-up).
 *
 * Two independent Redis primitives, mirroring the two independent knobs on
 * `ConnectionRateLimit`:
 *
 *   - pacing (`requestsPerMinute`): a single CAS'd "next-available-at"
 *     timestamp key (`ratelimit:pace:{connectionId}`), advanced by the
 *     pacing interval only on actual admission. This is minimum-interval
 *     spacing, not a bursty token bucket — the same algorithm the
 *     in-memory `RateLimiter` implements (see `rate-limiter.ts`), CAS'd
 *     through a Lua script instead of held in a process-local field. The
 *     script reads Redis's own `TIME` rather than the caller's local
 *     clock, so a skewed host cannot under- or over-throttle relative to
 *     the other process. `noteRetryAfter` writes into the SAME key (a
 *     `Retry-After` response is just an out-of-band push of
 *     "next-available-at" further into the future), so any process's next
 *     pacing check picks it up.
 *   - concurrency (`maxConcurrent`): the claim-then-rank ZSET pattern
 *     already shipped in `McpRateLimiter.claimRank`
 *     (apps/api/src/mcp/tools/ratelimit/mcp-rate-limiter.ts) — add a
 *     scored member for this call, evict anything older than
 *     `MAX_CALL_LIFETIME_MS` (self-heals a crashed caller that never
 *     released), then admit iff this call's own `ZRANK` is below the cap.
 *     Rank, not a count-then-compare, is what makes this race-safe under
 *     concurrent admission from both processes — see that file's own doc
 *     comment for why check-then-act and count-then-claim both fail.
 *
 * Ordering mirrors the in-memory `RateLimiter.drain()` exactly: concurrency
 * is claimed FIRST, then pacing is checked; only once BOTH gates pass is
 * admission granted. If pacing blocks after a concurrency slot was
 * tentatively claimed, that claim is rolled back (`ZREM`) before waiting —
 * pacing must only ever be consumed on an admission that actually happens,
 * never speculatively, or repeated concurrency contention would silently
 * compound extra pacing delay on top of the real cap.
 *
 * `getStatus()` stays synchronous per the unchanged `RateLimiterPort`
 * contract, so it can only report what THIS process instance has locally
 * observed — never a live cross-process read. This is a known, accepted
 * precision loss versus the single-process in-memory `RateLimiter` (see
 * the ADR-038 update); it does not affect throttling correctness, only the
 * accuracy of the operator-facing status readout.
 *
 * Priority (`background` vs `interactive`) is NOT arbitrated across
 * processes — that would need a materially heavier scheme (shared
 * priority-weighted queues) than any acceptance criterion here requires.
 * As a cheap, purely-local approximation, a `background` waiter adds a
 * small extra backoff jitter while an `interactive` waiter is queued on
 * THIS adapter instance, biasing (not guaranteeing) who wins the next
 * Redis contention round — see `pollDelayFor`.
 *
 * Fails open on any Redis error: `acquire()` resolves immediately with a
 * no-op release and `noteRetryAfter()` swallows the error, both logging a
 * warning — mirroring `McpRateLimiter`'s fail-open posture, since this
 * limiter is outbound-pacing hygiene, not a correctness-critical gate.
 *
 * **Bounded-staleness pacing fast path (tech-review follow-up, #2019).**
 * `HttpTransportFactory.forConnection` builds a limiter for EVERY connection,
 * including one with no `config.rateLimit` at all — and the pacing gate
 * above is checked unconditionally, so a fully-unconfigured connection would
 * otherwise pay a mandatory Redis round-trip on every single outbound call,
 * where the pre-#2015 in-memory `RateLimiter` paid nothing. `acquire()`
 * instead caches, per instance, "pacing is clear until this local timestamp"
 * (`localPaceOkUntil`) whenever `requestsPerMinute` is undefined and the pace
 * key admitted with zero wait, and skips the Redis round-trip entirely for
 * the next `unconfiguredPaceGraceMs` (default 200ms) while that holds. This
 * bounds — rather than eliminates — how quickly THIS instance observes a
 * `noteRetryAfter()` pushed by a DIFFERENT process while riding the cache: up
 * to `unconfiguredPaceGraceMs` of staleness, deliberately traded for
 * collapsing the common (no rate limit configured) case back to zero Redis
 * cost between grace windows. A `noteRetryAfter()` call on THIS instance
 * invalidates its own cache immediately, so same-process backoff is never
 * delayed by the grace window — only a genuinely cross-process push can be.
 * The concurrency gate is unaffected: it is never checked unconditionally
 * (skipped outright when `maxConcurrent` is undefined), so it had no
 * equivalent zero-config cost to begin with.
 *
 * **Concurrency claim scoring uses the local clock, not Redis `TIME`**
 * (mirroring `McpRateLimiter.claimRank`'s precedent), unlike the pacing gate
 * above. This is a narrower version of the same clock-skew question: under
 * real skew between hosts, the staleness eviction
 * (`zRemRangeByScore(inflightKey, 0, nowMs - MAX_CALL_LIFETIME_MS)`) compares
 * a score written by one process's clock against a bound computed from
 * another's, so a sufficiently fast-clocked evictor could in principle
 * reclaim a still-live claim from a slower-clocked one before it releases.
 * Accepted for v1, matching the existing `McpRateLimiter` shape rather than
 * introducing a bespoke atomic claim script here: `MAX_CALL_LIFETIME_MS`
 * (120s) is generously wide relative to any real outbound call, and NTP-
 * synced hosts keep the practical skew several orders of magnitude below
 * that floor.
 *
 * @module libs/shared/src/rate-limit
 */
import { randomUUID } from 'node:crypto';
import type { RedisClientType } from 'redis';
import { Logger } from '../logging';
import { RateLimitAbortedError, RateLimitTimeoutError } from './rate-limiter.errors';
import { MAX_TOTAL_WAIT_MS } from './rate-limiter';
import type {
  ConnectionRateLimit,
  RateLimitPriority,
  RateLimitRelease,
  RateLimitStatus,
} from './rate-limiter.types';
import type { RateLimiterPort } from './rate-limiter.port';

const PACE_KEY_PREFIX = 'ratelimit:pace:';
const INFLIGHT_KEY_PREFIX = 'ratelimit:inflight:';

/**
 * Floor for the pace key's TTL, in seconds — NOT the actual TTL. The Lua
 * scripts widen this to always cover the stored future timestamp; see
 * `PACE_ADMIT_SCRIPT`'s doc comment.
 */
const PACE_KEY_TTL_FLOOR_SECONDS = 3600;

/** How long an in-flight concurrency claim may live before it is presumed orphaned by a crashed caller. */
const MAX_CALL_LIFETIME_MS = 120_000;
const MAX_CALL_LIFETIME_SECONDS = MAX_CALL_LIFETIME_MS / 1_000;

/** Poll interval while waiting for a concurrency slot to free up (no push/pub-sub wakeup across processes). */
const DEFAULT_CONCURRENCY_POLL_INTERVAL_MS = 200;

/** Extra jitter a `background` waiter backs off by while an `interactive` waiter is queued on this instance. */
const BACKGROUND_YIELD_JITTER_MS = 50;

/**
 * Default bounded-staleness window for the unconfigured-pacing fast path —
 * see the class doc's "Bounded-staleness pacing fast path" section for the
 * trade-off this exists to make.
 */
const DEFAULT_UNCONFIGURED_PACE_GRACE_MS = 200;

const NOOP_RELEASE: RateLimitRelease = () => {
  /* fail-open: nothing to release */
};

/**
 * `now >= current ? admit and advance : reject with the wait` — computed
 * against Redis's own clock (`TIME`), not the caller's, so a clock-skewed
 * process cannot mis-pace relative to the other one.
 *
 * The key's `PX` lifetime is `max(ARGV[2] seconds, nextTs - now)` — ARGV[2]
 * is a *floor* (in seconds, converted to ms here), not the actual TTL. A
 * fixed floor alone would silently truncate any stored timestamp further
 * in the future than that floor (this bit an earlier draft: passing the
 * seconds-typed floor straight into `PX`, which expects milliseconds,
 * expired the key after a few seconds regardless of how far out `nextTs`
 * was — breaking pacing for any real interval and effectively discarding
 * every `noteRetryAfter` backoff almost immediately). Computing the TTL
 * from `nextTs` guarantees the key always outlives the timestamp it holds,
 * no matter how large `requestsPerMinute`'s interval or a `Retry-After`
 * delay is.
 */
const PACE_ADMIT_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local current = tonumber(redis.call('GET', KEYS[1]))
if current == nil or now >= current then
  local nextTs = now + tonumber(ARGV[1])
  local minTtlMs = tonumber(ARGV[2]) * 1000
  local ttlMs = nextTs - now
  if ttlMs < minTtlMs then
    ttlMs = minTtlMs
  end
  redis.call('SET', KEYS[1], nextTs, 'PX', ttlMs)
  return {1, 0}
else
  return {0, current - now}
end
`;

/**
 * CAS-advance the pace key to `max(current, now + delayMs)` — used by
 * `noteRetryAfter`. Same TTL-covers-`nextTs` guarantee as
 * `PACE_ADMIT_SCRIPT` above — see its doc comment.
 */
const PACE_ADVANCE_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local candidate = now + tonumber(ARGV[1])
local current = tonumber(redis.call('GET', KEYS[1]))
local nextTs = candidate
if current ~= nil and current > candidate then
  nextTs = current
end
local minTtlMs = tonumber(ARGV[2]) * 1000
local ttlMs = nextTs - now
if ttlMs < minTtlMs then
  ttlMs = minTtlMs
end
redis.call('SET', KEYS[1], nextTs, 'PX', ttlMs)
return nextTs
`;

export interface RedisRateLimiterDeps {
  /** Injectable clock for deterministic tests (concurrency bookkeeping only — pacing always uses Redis `TIME`). */
  now?: () => number;
  /** Injectable delay for deterministic, zero-real-wait-time tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Poll interval while blocked on the concurrency gate. Defaults to 200ms. */
  concurrencyPollIntervalMs?: number;
  /**
   * Bounded-staleness window (ms) for the unconfigured-pacing fast path —
   * see the class doc's "Bounded-staleness pacing fast path" section.
   * Defaults to 200ms; set to 0 to always consult Redis (no local caching).
   */
  unconfiguredPaceGraceMs?: number;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RateLimitAbortedError());
      return;
    }
    const onAbort = (): void => {
      cleanup();
      reject(new RateLimitAbortedError());
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    function cleanup(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

interface ConcurrencyClaim {
  admitted: boolean;
  callId: string;
}

export class RedisRateLimiterAdapter implements RateLimiterPort {
  private readonly logger = new Logger(RedisRateLimiterAdapter.name);
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly concurrencyPollIntervalMs: number;
  private readonly unconfiguredPaceGraceMs: number;
  private readonly paceKey: string;
  private readonly inflightKey: string;

  private lastPolicy: ConnectionRateLimit | undefined;
  private localInFlight = 0;
  private localQueued = 0;
  private localInteractiveWaiters = 0;
  private lastAcquiredAt: Date | null = null;
  /** See the class doc's "Bounded-staleness pacing fast path" section. */
  private localPaceOkUntil = 0;

  constructor(
    private readonly connectionId: string,
    private readonly redisClient: RedisClientType,
    deps: RedisRateLimiterDeps = {}
  ) {
    this.now = deps.now ?? ((): number => Date.now());
    this.sleep = deps.sleep ?? defaultSleep;
    this.concurrencyPollIntervalMs =
      deps.concurrencyPollIntervalMs ?? DEFAULT_CONCURRENCY_POLL_INTERVAL_MS;
    this.unconfiguredPaceGraceMs =
      deps.unconfiguredPaceGraceMs ?? DEFAULT_UNCONFIGURED_PACE_GRACE_MS;
    this.paceKey = `${PACE_KEY_PREFIX}${connectionId}`;
    this.inflightKey = `${INFLIGHT_KEY_PREFIX}${connectionId}`;
  }

  /** Kept for parity with the in-memory `RateLimiter`'s registry contract — refreshes the `getStatus()` snapshot even before any `acquire()` lands. */
  updatePolicy(policy: ConnectionRateLimit): void {
    this.lastPolicy = policy;
  }

  getStatus(): RateLimitStatus {
    return {
      requestsPerMinute: this.lastPolicy?.requestsPerMinute,
      maxConcurrent: this.lastPolicy?.maxConcurrent,
      inFlight: this.localInFlight,
      queued: this.localQueued,
      lastAcquiredAt: this.lastAcquiredAt,
    };
  }

  noteRetryAfter(delayMs: number): void {
    if (delayMs <= 0) return;
    // Invalidate the unconfigured-pacing fast path immediately for THIS
    // instance — a same-process backoff must never be delayed by the grace
    // window; only a genuinely cross-process push rides it out. See the
    // class doc's "Bounded-staleness pacing fast path" section.
    this.localPaceOkUntil = 0;
    const warn = (error: unknown): void => {
      this.logger.warn(
        `Failed to propagate Retry-After for connection ${this.connectionId} — Redis unavailable, this process's own pacing is unaffected. ${(error as Error).message}`
      );
    };
    // Guard both a rejected promise (the normal node-redis failure shape)
    // and a synchronous throw, so a client implementation that fails fast
    // can never escape this fire-and-forget call.
    try {
      Promise.resolve(
        this.redisClient.eval(PACE_ADVANCE_SCRIPT, {
          keys: [this.paceKey],
          arguments: [String(delayMs), String(PACE_KEY_TTL_FLOOR_SECONDS)],
        })
      ).catch(warn);
    } catch (error) {
      warn(error);
    }
  }

  async acquire(
    policy: ConnectionRateLimit,
    priority: RateLimitPriority = 'background',
    signal?: AbortSignal
  ): Promise<RateLimitRelease> {
    this.lastPolicy = policy;
    const startedAt = this.now();
    if (priority === 'interactive') {
      this.localInteractiveWaiters += 1;
    }
    this.localQueued += 1;

    // Tracks the most recent tentative concurrency claim across loop
    // iterations so a Redis failure between claiming and pacing (or any
    // other mid-loop throw) can roll it back in the `catch` below instead
    // of leaking an admitted-but-never-released ZSET member for up to
    // `MAX_CALL_LIFETIME_MS` — see that rollback for why a plain throw
    // must not skip it.
    let pendingClaim: ConcurrencyClaim | null = null;

    try {
      while (true) {
        this.throwIfAborted(signal);
        this.throwIfTimedOut(startedAt);

        pendingClaim = null;
        if (policy.maxConcurrent !== undefined) {
          pendingClaim = await this.claimConcurrency(policy.maxConcurrent);
          if (!pendingClaim.admitted) {
            await this.boundedSleep(this.pollDelayFor(priority), startedAt, signal);
            continue;
          }
        }

        // Checked UNCONDITIONALLY — not gated on `requestsPerMinute !==
        // undefined`. `noteRetryAfter()` writes into this same pace key for
        // ANY connection (`HttpTransportFactory` calls it off a bare
        // 429/503 `Retry-After` header regardless of the connection's
        // configured policy shape), so a connection with only
        // `maxConcurrent` set must still honour it — otherwise Retry-After
        // is silently ignored for that policy shape. Mirrors the in-memory
        // `RateLimiter.drain()`'s unconditional `nextAvailableAt` check.
        const pace = await this.checkPace(policy.requestsPerMinute);
        if (!pace.admitted) {
          if (pendingClaim) {
            await this.rollbackConcurrency(pendingClaim.callId);
            pendingClaim = null;
          }
          await this.boundedSleep(this.pollDelayFor(priority, pace.waitMs), startedAt, signal);
          continue;
        }

        this.localInFlight += 1;
        this.lastAcquiredAt = new Date(this.now());
        const admittedClaim = pendingClaim;
        pendingClaim = null;
        return this.buildRelease(admittedClaim?.callId ?? null);
      }
    } catch (error) {
      if (error instanceof RateLimitAbortedError || error instanceof RateLimitTimeoutError) {
        throw error;
      }
      if (pendingClaim) {
        // Best-effort — if Redis is why we're here, this may fail too; the
        // claim then self-heals via the inflight ZSET's staleness eviction
        // instead of holding the slot for the full MAX_CALL_LIFETIME_MS.
        await this.rollbackConcurrency(pendingClaim.callId).catch(() => undefined);
      }
      this.logger.warn(
        `Redis rate limiter unavailable for connection ${this.connectionId} — failing open. ${(error as Error).message}`
      );
      return NOOP_RELEASE;
    } finally {
      this.localQueued = Math.max(0, this.localQueued - 1);
      if (priority === 'interactive') {
        this.localInteractiveWaiters = Math.max(0, this.localInteractiveWaiters - 1);
      }
    }
  }

  private pollDelayFor(priority: RateLimitPriority, paceWaitMs?: number): number {
    const base = paceWaitMs ?? this.concurrencyPollIntervalMs;
    if (priority === 'background' && this.localInteractiveWaiters > 0) {
      return base + BACKGROUND_YIELD_JITTER_MS;
    }
    return base;
  }

  private async boundedSleep(ms: number, startedAt: number, signal?: AbortSignal): Promise<void> {
    const remaining = MAX_TOTAL_WAIT_MS - (this.now() - startedAt);
    if (remaining <= 0) {
      throw new RateLimitTimeoutError(this.now() - startedAt);
    }
    await this.sleep(Math.min(ms, remaining), signal);
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new RateLimitAbortedError();
    }
  }

  private throwIfTimedOut(startedAt: number): void {
    const elapsed = this.now() - startedAt;
    if (elapsed >= MAX_TOTAL_WAIT_MS) {
      throw new RateLimitTimeoutError(elapsed);
    }
  }

  /**
   * `requestsPerMinute === undefined` still runs this check (with a 0ms
   * interval) rather than being skipped — see the call site's comment for
   * why: a bare `noteRetryAfter()` push must be honoured even when this
   * connection has no configured pacing of its own.
   *
   * For that unconfigured case specifically, this is fronted by a bounded-
   * staleness local cache (`localPaceOkUntil`) instead of always hitting
   * Redis — see the class doc's "Bounded-staleness pacing fast path"
   * section for why and its accepted trade-off.
   */
  private async checkPace(
    requestsPerMinute: number | undefined
  ): Promise<{ admitted: boolean; waitMs: number }> {
    if (
      requestsPerMinute === undefined &&
      this.unconfiguredPaceGraceMs > 0 &&
      this.now() < this.localPaceOkUntil
    ) {
      return { admitted: true, waitMs: 0 };
    }

    const { admitted, waitMs } = await this.tryAdvancePace(requestsPerMinute);
    if (admitted && requestsPerMinute === undefined) {
      this.localPaceOkUntil = this.now() + this.unconfiguredPaceGraceMs;
    }
    return { admitted, waitMs };
  }

  private async tryAdvancePace(
    requestsPerMinute: number | undefined
  ): Promise<{ admitted: boolean; waitMs: number }> {
    const intervalMs = requestsPerMinute !== undefined ? 60_000 / requestsPerMinute : 0;
    const result = (await this.redisClient.eval(PACE_ADMIT_SCRIPT, {
      keys: [this.paceKey],
      arguments: [String(Math.round(intervalMs)), String(PACE_KEY_TTL_FLOOR_SECONDS)],
    })) as [number, number];
    const [admitted, waitMs] = result;
    return { admitted: admitted === 1, waitMs };
  }

  private async claimConcurrency(maxConcurrent: number): Promise<ConcurrencyClaim> {
    const callId = `${this.now()}-${randomUUID()}`;
    const nowMs = this.now();
    await this.redisClient.zRemRangeByScore(this.inflightKey, 0, nowMs - MAX_CALL_LIFETIME_MS);
    await this.redisClient.zAdd(this.inflightKey, { score: nowMs, value: callId });
    await this.redisClient.expire(this.inflightKey, MAX_CALL_LIFETIME_SECONDS);
    const rank = await this.redisClient.zRank(this.inflightKey, callId);
    if (rank === null || rank >= maxConcurrent) {
      await this.rollbackConcurrency(callId);
      return { admitted: false, callId };
    }
    return { admitted: true, callId };
  }

  private async rollbackConcurrency(callId: string): Promise<void> {
    await this.redisClient.zRem(this.inflightKey, callId);
  }

  private buildRelease(claimId: string | null): RateLimitRelease {
    let released = false;
    return (): void => {
      if (released) return;
      released = true;
      this.localInFlight = Math.max(0, this.localInFlight - 1);
      if (claimId) {
        this.redisClient.zRem(this.inflightKey, claimId).catch((error: unknown) => {
          this.logger.warn(
            `Failed to release Redis rate-limit slot for connection ${this.connectionId}; it will age out. ${(error as Error).message}`
          );
        });
      }
    };
  }
}
