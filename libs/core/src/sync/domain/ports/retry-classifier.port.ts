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
/**
 * A platform's answer to "this failure is not the job's own fault, wait".
 *
 * `delaySeconds` is how long to wait before the next attempt; `reason` is a
 * short label the runner prefixes onto the persisted error so an operator can
 * tell a deferral apart from a genuine failure in the job record.
 */
export interface RetryDeferral {
  readonly delaySeconds: number;
  readonly reason: string;
}

/**
 * Per-platform retry classification, registered by each plugin through
 * `host.retryClassifierRegistry.register(adapterKey, classifier)`.
 *
 * **Ambiguous non-idempotent writes are a contract, not a plugin choice
 * (#3469).** The runner retries every job-level failure unless a registered
 * classifier says otherwise, so an HTTP client that refuses to re-send an
 * ambiguous write only moves the duplicate one layer up. A plugin whose
 * client issues a non-idempotent write (POST/PATCH not opted into
 * `idempotent: true`) MUST:
 *
 *   1. raise a distinguishable exception when that write fails ambiguously -
 *      a `5xx` or a network/timeout error after the request may already have
 *      been applied. Where the plugin already throws a transport exception
 *      for that failure, subclass it so existing `instanceof` consumers keep
 *      their behaviour (InPost, Allegro and PrestaShop do), and
 *   2. answer `true` for that exception from `isNonRetryable`, checked before
 *      any broader branch for its parent class.
 *
 * Without step 2 the job re-runs and re-sends the write: a second label, a
 * second order. The in-tree implementations of the rule, one per plugin since
 * plugins may not import each other (ADR-003): `InpostAmbiguousWriteException`
 * / `InpostRetryClassifierAdapter`, `AllegroAmbiguousWriteException` /
 * `AllegroRetryClassifierAdapter`, `WooCommerceAmbiguousWriteException` /
 * `WooCommerceRetryClassifierAdapter`, `PrestashopAmbiguousWriteException` /
 * `PrestashopRetryClassifierAdapter`.
 *
 * A `429` is NOT ambiguous - the destination refused before processing the
 * request - so it stays retryable for every write and honours `Retry-After`
 * (`AllegroRateLimitException` inside the client; `getRetryDeferral` below
 * at the job level). Keep the ambiguous-write branch narrow: the registry ORs
 * every classifier's answer, so classifying the generic transport exception
 * would make every transient failure of that plugin terminal.
 *
 * @see docs/plugin-author-guide.md § Ambiguous writes and the job runner
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

  /**
   * Returns a deferral when the cause says the destination is unable to serve
   * us right now for a reason that is not this job's own failure - the shop
   * throttling us (429) or being unavailable (503). The runner then requeues
   * penalty-free instead of consuming an attempt, reusing the path
   * `RateLimitTimeoutError` already takes (#1810). Returning `null`, or not
   * implementing the method at all, keeps the pre-existing behaviour: the
   * failure consumes an attempt and walks the backoff ladder.
   *
   * Optional so every existing classifier stays source-compatible. A deferral
   * must never be reported for a deterministic failure: a job that always
   * defers never reaches `dead`, so the answer has to come from a signal the
   * destination itself sent.
   */
  getRetryDeferral?(cause: unknown): RetryDeferral | null;
}
