/**
 * Job failure policy
 *
 * The pure half of how a failed job is classified and backed off. Shared by
 * `SyncJobRunner` (its own job) and `MasterProductSyncHandler` (drained peer
 * jobs it settles itself, #3986), so a peer failure takes exactly the path it
 * would have taken had it run alone, and the retry ladder exists once.
 *
 * @module apps/worker/src/sync
 */

import type {
  AuthFailureClassifierRegistryService,
  RetryClassifierRegistryService,
  RetryDeferral,
} from '@openlinker/core/sync';
import { ContendedWriteError, SyncJobExecutionError } from '@openlinker/core/sync';
import { OfferCreationInvariantException } from '@openlinker/core/listings';
import { RateLimitTimeoutError } from '@openlinker/shared/rate-limit';

export const RETRY_BASE_DELAY_SECONDS = 30;
export const RETRY_MAX_DELAY_SECONDS = 6 * 60 * 60;
export const RETRY_MULTIPLIER = 2;
export const RATE_LIMIT_TIMEOUT_REQUEUE_DELAY_SECONDS = 30;
export const CONTENDED_WRITE_DEFERRAL_SECONDS = 15;
export const MAX_DEFERRED_TOTAL_SECONDS_DEFAULT = 24 * 60 * 60;

/** Exponential backoff for a 1-based attempt number, capped at 6 h. */
export function calculateRetryBackoffSeconds(attemptNumber: number): number {
  const delay = RETRY_BASE_DELAY_SECONDS * Math.pow(RETRY_MULTIPLIER, attemptNumber - 1);
  return Math.min(delay, RETRY_MAX_DELAY_SECONDS);
}

/** Unwrap one `SyncJobExecutionError` layer so classifiers see the original error. */
export function unwrapJobFailureCause(error: unknown): unknown {
  return error instanceof SyncJobExecutionError && error.cause ? error.cause : error;
}

export function isRateLimitTimeoutFailure(error: unknown): boolean {
  return unwrapJobFailureCause(error) instanceof RateLimitTimeoutError;
}

export function isNonRetryableFailure(
  error: unknown,
  registries: { retry: RetryClassifierRegistryService }
): boolean {
  const cause = unwrapJobFailureCause(error);
  if (cause instanceof OfferCreationInvariantException) {
    return true;
  }
  return registries.retry.isNonRetryable(cause);
}

export function isCredentialRejectedFailure(
  error: unknown,
  registries: { authFailure: AuthFailureClassifierRegistryService }
): boolean {
  return registries.authFailure.isCredentialRejected(unwrapJobFailureCause(error));
}

/** Deferral for this failure, or null. Callers test non-retryable FIRST (safety wins the tie). */
export function resolveFailureDeferral(
  error: unknown,
  registries: { retry: RetryClassifierRegistryService }
): RetryDeferral | null {
  const cause = unwrapJobFailureCause(error);
  if (cause instanceof ContendedWriteError) {
    return {
      delaySeconds: CONTENDED_WRITE_DEFERRAL_SECONDS,
      reason: 'Write contended by a peer',
    };
  }
  return registries.retry.resolveRetryDeferral(cause);
}
