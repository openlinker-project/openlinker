/**
 * Rate Limit Priority Context
 *
 * The first ambient-context primitive in this codebase (#1810, ADR-038).
 * Carries a request/job's rate-limit priority — and an optional cancellation
 * signal — from the orchestration layer (`SyncJobRunner.processJob`, an
 * apps/api `APP_INTERCEPTOR`) down to wherever a plugin's `fetchImpl`
 * actually calls `RateLimiterPort.acquire()`, without threading a parameter
 * through 26+ `SyncJobHandler.execute()` call sites or any adapter
 * signature. Absent context defaults to `'background'` — the safe
 * direction, since nothing prior to #1810 has any priority concept.
 *
 * @module libs/shared/src/rate-limit
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RateLimitPriority } from './rate-limiter.types';

export interface RateLimitPriorityContext {
  priority: RateLimitPriority;
  /** Cancels a queued `acquire()` wait — worker graceful shutdown or interactive-request client disconnect. */
  signal?: AbortSignal;
}

const storage = new AsyncLocalStorage<RateLimitPriorityContext>();

/** Run `fn` with `ctx` as the ambient priority context for its entire async call tree. */
export function runWithPriority<T>(ctx: RateLimitPriorityContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Defaults to `'background'` when no context is active (no code path pre-#1810 set one). */
export function getCurrentPriority(): RateLimitPriority {
  return storage.getStore()?.priority ?? 'background';
}

/** The active context's cancellation signal, if any. */
export function getCurrentRateLimitSignal(): AbortSignal | undefined {
  return storage.getStore()?.signal;
}
