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
 *   - concurrency (`maxConcurrent`): a single atomic Lua script
 *     (`CONCURRENCY_CLAIM_SCRIPT`) that evicts anything older than
 *     `MAX_CALL_LIFETIME_MS` (self-heals a crashed caller that never
 *     released), adds a scored member for this call, and admits iff this
 *     call's own `ZRANK` is below the cap — rolling itself back inside the
 *     SAME script when it isn't. One round trip, not four, and the score is
 *     derived from Redis's own `TIME` (not the caller's local clock) via a
 *     persisted per-key monotonic counter (`lastScoreKey`) that breaks
 *     same-millisecond ties by SCRIPT EXECUTION ORDER — since Redis
 *     serializes `EVAL` calls, this is real arrival order, not a
 *     lexicographic comparison of an unordered random member. This closes
 *     two gaps an earlier draft had: scoring by the caller's local clock
 *     (skew between hosts could invert admission order) and tie-breaking
 *     equal-millisecond claims by a raw UUID (letting a later arrival
 *     out-rank one already admitted — see `McpRateLimiter.claimRank`'s doc
 *     for why that specific mistake over-admits past the cap).
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
 * Redis contention round — see `pollDelayFor`. This is a weak, non-ordering
 * bias, not a real priority guarantee: every poll re-claims with a fresh
 * member/score, so there is no seniority queue and a long-waiting caller
 * competes on equal footing with a freshly-arrived one each round. Accepted
 * for v1 (tracked as a follow-up) — closing it needs a genuine cross-poll
 * waiting queue, which is a materially bigger change than this file's scope.
 *
 * **Fails DEGRADED, not open, on a Redis outage or a hung call.** Every
 * Redis await in this file is bounded by `redisCallTimeoutMs` (default
 * 1000ms) — node-redis's default offline queue means a post-boot socket
 * drop otherwise HANGS a command rather than rejecting it, which would
 * silently stall every outbound HTTP call in the process. On a bounded
 * timeout or a rejected Redis call, `acquire()` delegates the CURRENT call
 * to a private per-process in-memory `RateLimiter` (`insuranceLimiter`)
 * instead of admitting unconditionally — mirroring `rate-limiter-flexible`'s
 * "insurance limiter" pattern. This keeps THIS process's own pacing/
 * concurrency enforced (just not cross-process-shared) for as long as Redis
 * is unavailable, rather than removing all throttling — a marketplace API
 * ban is not a hygiene-only outcome. `noteRetryAfter()` mirrors a
 * `Retry-After` into the insurance limiter synchronously (in addition to
 * its normal Redis write), so a 429 observed during an outage is not lost.
 * Degraded-mode entry logs at `error` once per transition, then at most one
 * `warn` per 30s while it persists, to avoid drowning an operator's logs
 * during an incident; recovery (the next successful Redis round trip) logs
 * once. This is per-adapter-instance state — each `acquire()` call retries
 * Redis fresh, so a transient blip self-heals on the next call.
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
 * equivalent zero-config cost to begin with. `PACE_ADMIT_SCRIPT` is also a
 * pure read (no `SET`) on this fast path's cold-cache probe, since a
 * zero-interval admission has nothing to advance.
 *
 * @module libs/shared/src/rate-limit
 */
import { randomUUID } from 'node:crypto';
import type { RedisClientType } from 'redis';
import { Logger } from '../logging';
import { RateLimiter } from './rate-limiter';
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
const LAST_SCORE_KEY_PREFIX = 'ratelimit:inflight-seq:';

/**
 * Floor for the pace key's TTL, in seconds — NOT the actual TTL. The Lua
 * scripts widen this to always cover the stored future timestamp; see
 * `PACE_ADMIT_SCRIPT`'s doc comment.
 */
const PACE_KEY_TTL_FLOOR_SECONDS = 3600;

/**
 * How long an in-flight concurrency claim may live before it is presumed
 * orphaned by a crashed caller. Deliberately distinct from
 * `MAX_TOTAL_WAIT_MS` (also 120s) — the two bound unrelated things (a claim
 * held by an in-flight call vs. total time spent waiting for one) and an
 * earlier draft's accidental equality made an integration test race its own
 * timeout (see `docs/lessons.md`). Set above the slowest known real outbound
 * call in this codebase — inFakt/KSeF issuance runs ~90s — so a legitimately
 * slow call does not have its slot silently reclaimed mid-flight.
 */
const MAX_CALL_LIFETIME_MS = 300_000;
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

/** Default bound on a single Redis await — see the class doc's "Fails DEGRADED, not open" section. */
const DEFAULT_REDIS_CALL_TIMEOUT_MS = 1_000;

/** Minimum interval between repeated degraded-mode log lines, to avoid drowning the logs during an outage. */
const DEGRADED_LOG_INTERVAL_MS = 30_000;

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
local interval = tonumber(ARGV[1])
if current == nil or now >= current then
  if interval == 0 then
    return {1, 0}
  end
  local nextTs = now + interval
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
 * Atomic concurrency claim — evict, add, expire, rank, and (on rejection)
 * roll back, all in one round trip. See the class doc's `concurrency`
 * bullet for the monotonic-score tie-break this relies on to make `ZRANK`
 * a real ceiling rather than an approximation.
 *
 * `KEYS[2]` (`lastScoreKey`) persists the last score handed out for this
 * connection's inflight set. Scoring by Redis `TIME` alone still lets two
 * `EVAL` calls land in the same millisecond; since Redis serializes script
 * execution, the SECOND call to observe a given millisecond is provably the
 * one that arrived later, so bumping the score by a fixed epsilon
 * (`+0.001`, far below 1ms) above the last-seen value turns "tied" into
 * "correctly ordered by execution order" without needing a real UUID
 * tie-break at all.
 */
const CONCURRENCY_CLAIM_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local maxLifetimeMs = tonumber(ARGV[1])
local maxConcurrent = tonumber(ARGV[2])
local ttlSeconds = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - maxLifetimeMs)

local last = tonumber(redis.call('GET', KEYS[2]))
local score = now
if last ~= nil and score <= last then
  score = last + 0.001
end
redis.call('SET', KEYS[2], score, 'PX', ttlSeconds * 1000)

redis.call('ZADD', KEYS[1], score, member)
redis.call('EXPIRE', KEYS[1], ttlSeconds)

local rank = redis.call('ZRANK', KEYS[1], member)
if rank == false or rank >= maxConcurrent then
  redis.call('ZREM', KEYS[1], member)
  return {0}
end
return {1}
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
  /**
   * Bound on a single Redis await — see the class doc's "Fails DEGRADED,
   * not open" section. Defaults to 1000ms.
   */
  redisCallTimeoutMs?: number;
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

/** A single Redis await exceeded `redisCallTimeoutMs` — treated identically to a rejected Redis call. */
class RedisCallTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`Redis rate-limiter call "${operation}" timed out after ${timeoutMs}ms`);
    this.name = 'RedisCallTimeoutError';
  }
}

export class RedisRateLimiterAdapter implements RateLimiterPort {
  private readonly logger = new Logger(RedisRateLimiterAdapter.name);
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly concurrencyPollIntervalMs: number;
  private readonly unconfiguredPaceGraceMs: number;
  private readonly redisCallTimeoutMs: number;
  private readonly paceKey: string;
  private readonly inflightKey: string;
  private readonly lastScoreKey: string;
  /**
   * Per-process fallback used whenever Redis is unreachable or a call times
   * out — see the class doc's "Fails DEGRADED, not open" section. This is
   * the same `RateLimiter` class the pre-#2015 in-memory registry used;
   * here it is composed privately rather than shared, so its state is
   * scoped to exactly this adapter instance's degraded episodes.
   */
  private readonly insuranceLimiter: RateLimiter;

  private lastPolicy: ConnectionRateLimit | undefined;
  private localInFlight = 0;
  private localQueued = 0;
  private localInteractiveWaiters = 0;
  private lastAcquiredAt: Date | null = null;
  /** See the class doc's "Bounded-staleness pacing fast path" section. */
  private localPaceOkUntil = 0;
  private degraded = false;
  private lastDegradedLogAt = 0;

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
    this.redisCallTimeoutMs = deps.redisCallTimeoutMs ?? DEFAULT_REDIS_CALL_TIMEOUT_MS;
    this.paceKey = `${PACE_KEY_PREFIX}${connectionId}`;
    this.inflightKey = `${INFLIGHT_KEY_PREFIX}${connectionId}`;
    this.lastScoreKey = `${LAST_SCORE_KEY_PREFIX}${connectionId}`;
    this.insuranceLimiter = new RateLimiter({}, { now: this.now });
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
    // Mirror the backoff into the insurance limiter SYNCHRONOUSLY, in
    // addition to the Redis write below — a 429/503 observed during a Redis
    // outage must not be silently dropped just because the write it would
    // normally ride on cannot land. See the class doc's "Fails DEGRADED,
    // not open" section.
    this.insuranceLimiter.noteRetryAfter(delayMs);
    const warn = (error: unknown): void => {
      this.logger.warn(
        `Failed to propagate Retry-After for connection ${this.connectionId} — Redis unavailable, this process's own pacing is unaffected. ${(error as Error).message}`
      );
    };
    // Guard both a rejected promise (the normal node-redis failure shape)
    // and a synchronous throw, so a client implementation that fails fast
    // can never escape this fire-and-forget call.
    try {
      this.withTimeout(
        'noteRetryAfter',
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

        this.noteRecoveredIfNeeded();
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
      this.enterDegraded(error);
      // Fail DEGRADED, not open — delegate THIS call to the per-process
      // insurance limiter instead of admitting unconditionally. See the
      // class doc's "Fails DEGRADED, not open" section.
      const remaining = MAX_TOTAL_WAIT_MS - (this.now() - startedAt);
      if (remaining <= 0) {
        throw new RateLimitTimeoutError(this.now() - startedAt);
      }
      return this.insuranceLimiter.acquire(policy, priority, signal);
    } finally {
      this.localQueued = Math.max(0, this.localQueued - 1);
      if (priority === 'interactive') {
        this.localInteractiveWaiters = Math.max(0, this.localInteractiveWaiters - 1);
      }
    }
  }

  /** Logs the transition into degraded mode at `error`, then at most once per `DEGRADED_LOG_INTERVAL_MS` while it persists. */
  private enterDegraded(error: unknown): void {
    const now = this.now();
    if (!this.degraded) {
      this.degraded = true;
      this.lastDegradedLogAt = now;
      this.logger.error(
        `Redis rate limiter unavailable for connection ${this.connectionId} — falling back to per-process in-memory limiting (degraded, not unthrottled). ${(error as Error).message}`
      );
      return;
    }
    if (now - this.lastDegradedLogAt >= DEGRADED_LOG_INTERVAL_MS) {
      this.lastDegradedLogAt = now;
      this.logger.warn(
        `Redis rate limiter for connection ${this.connectionId} still degraded. ${(error as Error).message}`
      );
    }
  }

  private noteRecoveredIfNeeded(): void {
    if (this.degraded) {
      this.degraded = false;
      this.logger.log(
        `Redis rate limiter for connection ${this.connectionId} recovered from degraded mode.`
      );
    }
  }

  /** Bounds a single Redis await — see the class doc's "Fails DEGRADED, not open" section for why this exists. */
  private async withTimeout<T>(operation: string, promise: Promise<T>): Promise<T> {
    // If the timeout wins the race below, the original Redis call may still
    // settle later, out of band — attach a no-op handler so that late
    // settlement never surfaces as an unhandled rejection.
    promise.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new RedisCallTimeoutError(operation, this.redisCallTimeoutMs));
      }, this.redisCallTimeoutMs);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
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
    const result = (await this.withTimeout(
      'checkPace',
      this.redisClient.eval(PACE_ADMIT_SCRIPT, {
        keys: [this.paceKey],
        arguments: [String(Math.round(intervalMs)), String(PACE_KEY_TTL_FLOOR_SECONDS)],
      })
    )) as [number, number];
    const [admitted, waitMs] = result;
    return { admitted: admitted === 1, waitMs };
  }

  /** One atomic round trip — see `CONCURRENCY_CLAIM_SCRIPT`'s doc comment. */
  private async claimConcurrency(maxConcurrent: number): Promise<ConcurrencyClaim> {
    const callId = randomUUID();
    const result = (await this.withTimeout(
      'claimConcurrency',
      this.redisClient.eval(CONCURRENCY_CLAIM_SCRIPT, {
        keys: [this.inflightKey, this.lastScoreKey],
        arguments: [
          String(MAX_CALL_LIFETIME_MS),
          String(maxConcurrent),
          String(MAX_CALL_LIFETIME_SECONDS),
          callId,
        ],
      })
    )) as [number];
    const [admitted] = result;
    return { admitted: admitted === 1, callId };
  }

  private async rollbackConcurrency(callId: string): Promise<void> {
    await this.withTimeout('rollbackConcurrency', this.redisClient.zRem(this.inflightKey, callId));
  }

  private buildRelease(claimId: string | null): RateLimitRelease {
    let released = false;
    return (): void => {
      if (released) return;
      released = true;
      this.localInFlight = Math.max(0, this.localInFlight - 1);
      if (claimId) {
        this.withTimeout('release', this.redisClient.zRem(this.inflightKey, claimId))
          .then((removed) => {
            if (removed === 0) {
              // The member was already gone — either evicted after exceeding
              // MAX_CALL_LIFETIME_MS while still legitimately in flight, or
              // double-released. Either way, the concurrency cap may have
              // briefly admitted one extra caller; surface it rather than
              // stay silent.
              this.logger.warn(
                `Redis rate-limit slot for connection ${this.connectionId} was already reclaimed before release.`
              );
            }
          })
          .catch((error: unknown) => {
            this.logger.warn(
              `Failed to release Redis rate-limit slot for connection ${this.connectionId}; it will age out. ${(error as Error).message}`
            );
          });
      }
    };
  }
}
