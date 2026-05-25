/**
 * Auth Failure Classifier Port
 *
 * Per-platform contract for deciding whether an error caught by the
 * `SyncJobRunner` is a **terminal credential rejection** — i.e. the
 * connection's stored credentials have been definitively rejected by the
 * external platform (e.g. Allegro `400 invalid_grant` on token refresh) and
 * re-authentication is required. When true, the runner flags the originating
 * connection so the scheduler stops enqueuing dead-on-arrival jobs and the
 * operator is prompted to re-authenticate (#819).
 *
 * This is a deliberately narrower question than `RetryClassifierPort`: a 422
 * validation error or an `OfferCreationInvariantException` is non-retryable but
 * is NOT a credential rejection — those must never flag the connection. A
 * transient `network-failure` during refresh is surfaced by the adapter as a
 * retryable network exception and never reaches this classifier at all.
 *
 * Resolved by the runner via `AuthFailureClassifierRegistryService`, which
 * aggregates answers across registered classifiers — the runner has the raw
 * error in hand, not an `adapterKey`, so dispatch is OR-across-all rather than
 * indexed by key (mirrors the retry-classifier seam, #581).
 *
 * Implementations should return `false` for unknown errors. A classifier never
 * sees errors from other platforms because each owns disjoint exception
 * hierarchies, so the unknown-error branch is purely a safety net.
 *
 * @module libs/core/src/sync/domain/ports
 * @see {@link AuthFailureClassifierRegistryService} for the registry that
 *   aggregates implementations.
 */
export interface AuthFailureClassifierPort {
  /**
   * Returns `true` iff the cause is a terminal credential rejection for this
   * platform's exception hierarchy (re-authentication required). Returns
   * `false` otherwise (transient failures, deterministic non-auth 4xx,
   * unknown errors).
   *
   * The runner unwraps `SyncJobExecutionError.cause` before calling, so
   * implementations see the original platform exception directly.
   */
  isCredentialRejected(cause: unknown): boolean;
}
