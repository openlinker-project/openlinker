/**
 * Rate Limiter
 *
 * Minimum-interval spacing (capacity ~1, not a bursty token bucket) plus a
 * concurrency semaphore, both gated on a single per-connection queue — one
 * bucket, not two additive pools (#1810). A queued `acquire()` is dequeued
 * in STRICT priority order: `interactive` callers always jump ahead of
 * already-queued `background` ones. There is no reservation/floor
 * guaranteeing background progress — a sustained stream of interactive
 * callers can starve a queued background waiter indefinitely (bounded only
 * by `MAX_TOTAL_WAIT_MS`, at which point it times out rather than hanging
 * forever). Acceptable for v1: background traffic is worker jobs, which
 * retry; a future age-promotion policy is a candidate follow-up if this
 * proves painful in practice.
 *
 * @module libs/shared/src/rate-limit
 */
import { RateLimitAbortedError, RateLimitTimeoutError } from './rate-limiter.errors';
import type {
  ConnectionRateLimit,
  RateLimitPriority,
  RateLimitRelease,
  RateLimitStatus,
} from './rate-limiter.types';
import type { RateLimiterPort } from './rate-limiter.port';

/** Bounds how long a single `acquire()` call may wait for a slot. */
export const MAX_TOTAL_WAIT_MS = 120_000;

export interface RateLimiterDeps {
  /** Injectable clock for deterministic, zero-real-wait-time tests. */
  now?: () => number;
}

interface Waiter {
  priority: RateLimitPriority;
  enqueuedAt: number;
  resolve: (release: RateLimitRelease) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

export class RateLimiter implements RateLimiterPort {
  private policy: ConnectionRateLimit;
  private readonly now: () => number;
  private inFlight = 0;
  private nextAvailableAt = 0;
  private lastAcquiredAt: Date | null = null;
  private readonly queue: Waiter[] = [];
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(policy: ConnectionRateLimit, deps: RateLimiterDeps = {}) {
    this.policy = policy;
    this.now = deps.now ?? ((): number => Date.now());
  }

  /** Update the live policy — read on every `acquire()`, never cached. */
  updatePolicy(policy: ConnectionRateLimit): void {
    this.policy = policy;
  }

  getStatus(): RateLimitStatus {
    return {
      requestsPerMinute: this.policy.requestsPerMinute,
      maxConcurrent: this.policy.maxConcurrent,
      inFlight: this.inFlight,
      queued: this.queue.length,
      lastAcquiredAt: this.lastAcquiredAt,
    };
  }

  noteRetryAfter(delayMs: number): void {
    if (delayMs <= 0) return;
    this.nextAvailableAt = Math.max(this.nextAvailableAt, this.now() + delayMs);
  }

  acquire(
    policy: ConnectionRateLimit,
    priority: RateLimitPriority = 'background',
    signal?: AbortSignal
  ): Promise<RateLimitRelease> {
    // Authoritative re-read, independent of updatePolicy(). A caller that
    // goes through RateLimiterRegistry.get() already had updatePolicy()
    // applied there, making this a no-op re-assignment in that path — but a
    // caller holding the limiter directly (tests, or any future non-registry
    // caller) never calls updatePolicy() at all, so acquire() must not skip
    // this assignment.
    this.policy = policy;

    return new Promise<RateLimitRelease>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new RateLimitAbortedError());
        return;
      }

      const enqueuedAt = this.now();
      const timeoutHandle = setTimeout(() => {
        this.removeFromQueue(waiter);
        waiter.cleanup();
        waiter.reject(new RateLimitTimeoutError(this.now() - enqueuedAt));
      }, MAX_TOTAL_WAIT_MS);
      if (typeof timeoutHandle.unref === 'function') {
        timeoutHandle.unref();
      }

      const onAbort = (): void => {
        this.removeFromQueue(waiter);
        waiter.cleanup();
        waiter.reject(new RateLimitAbortedError());
      };
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      const waiter: Waiter = {
        priority,
        enqueuedAt,
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timeoutHandle);
          signal?.removeEventListener('abort', onAbort);
        },
      };

      this.insertByPriority(waiter);
      this.scheduleDrain();
    });
  }

  private insertByPriority(waiter: Waiter): void {
    if (waiter.priority === 'interactive') {
      const idx = this.queue.findIndex((w) => w.priority === 'background');
      if (idx === -1) {
        this.queue.push(waiter);
      } else {
        this.queue.splice(idx, 0, waiter);
      }
      return;
    }
    this.queue.push(waiter);
  }

  private removeFromQueue(waiter: Waiter): void {
    const idx = this.queue.indexOf(waiter);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
    }
  }

  // Drains synchronously (no `queueMicrotask` indirection) — jest's modern
  // fake timers also fake `queueMicrotask`, so a real caller and a
  // fake-timer test both need `drain()` to run inline with the triggering
  // `acquire()`/`release()` call, not on a deferred tick.
  private scheduleDrain(): void {
    this.drain();
  }

  private drain(): void {
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }

    while (this.queue.length > 0) {
      const { maxConcurrent, requestsPerMinute } = this.policy;

      if (maxConcurrent !== undefined && this.inFlight >= maxConcurrent) {
        return;
      }

      const nowMs = this.now();
      if (requestsPerMinute !== undefined && nowMs < this.nextAvailableAt) {
        const delay = this.nextAvailableAt - nowMs;
        this.drainTimer = setTimeout(() => this.drain(), delay);
        if (typeof this.drainTimer.unref === 'function') {
          this.drainTimer.unref();
        }
        return;
      }

      const waiter = this.queue.shift();
      if (!waiter) {
        return;
      }
      waiter.cleanup();

      this.inFlight += 1;
      this.lastAcquiredAt = new Date(nowMs);
      if (requestsPerMinute !== undefined) {
        const minIntervalMs = 60_000 / requestsPerMinute;
        this.nextAvailableAt = Math.max(this.nextAvailableAt, nowMs) + minIntervalMs;
      }

      let released = false;
      const release: RateLimitRelease = () => {
        if (released) return;
        released = true;
        this.inFlight -= 1;
        this.scheduleDrain();
      };
      waiter.resolve(release);
    }
  }
}
