/**
 * Retry Classifier Registry Interface
 *
 * The read side of the per-plugin retry-classifier registry: the two questions
 * a consumer asks about a raw error without importing any platform exception
 * class. Consumed by the sync runner and, since #3984, by order sync, which
 * needs the same answer to decide whether a destination failure is deferrable.
 *
 * @module libs/core/src/sync/infrastructure/adapters
 * @see {@link RetryClassifierRegistryService} for the implementation
 */
import type { RetryDeferral } from '../../domain/ports/retry-classifier.port';

export interface IRetryClassifierRegistry {
  /** True when any registered classifier reports the cause as non-retryable. */
  isNonRetryable(cause: unknown): boolean;

  /** The first usable, coerced deferral a registered classifier reports, else null. */
  resolveRetryDeferral(cause: unknown): RetryDeferral | null;
}
