/**
 * Retry Classifier Port
 *
 * Per-platform contract for classifying whether an error caught by the
 * `SyncJobRunner` is non-retryable — i.e., a deterministic failure where
 * retrying burns worker capacity and masks the real issue
 * (auth failure, deterministic 4xx, etc.). Implemented by integration
 * adapters (e.g., `AllegroRetryClassifierAdapter`) that own their own
 * exception hierarchies.
 *
 * Resolved by the runner via `RetryClassifierRegistryService`, which
 * aggregates answers across registered classifiers — the runner has the
 * raw error in hand, not an `adapterKey`, so dispatch is OR-across-all
 * rather than indexed by key (#581).
 *
 * Implementations should return `false` for unknown errors — i.e., the
 * default is "retryable". A classifier never sees errors from other
 * platforms because each owns disjoint exception hierarchies, so the
 * unknown-error branch is purely a safety net.
 *
 * @module libs/core/src/sync/domain/ports
 * @see {@link RetryClassifierRegistryService} for the registry that
 *   aggregates implementations.
 */
export interface RetryClassifierPort {
  /**
   * Returns `true` if the cause is a deterministic, non-retryable failure
   * for this platform's exception hierarchy. Returns `false` otherwise
   * (transient errors, unknown errors).
   *
   * The runner unwraps `SyncJobExecutionError.cause` before calling, so
   * implementations see the original platform exception directly.
   */
  isNonRetryable(cause: unknown): boolean;
}
