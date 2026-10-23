/**
 * InPost Retry Classifier Adapter
 *
 * Implements `RetryClassifierPort` (#581) for the InPost platform — answers
 * the worker runner's "is this error non-retryable?" question for InPost's
 * own exception hierarchy. Before #3469 InPost registered NO classifier at
 * all, so every InPost failure was retryable by default at the job level —
 * including an ambiguous failure `InpostHttpClient` had already refused to
 * retry internally, which meant `SyncJobRunner` re-ran the whole job and
 * `generateLabel` POSTed again, minting a second paid shipping label for one
 * parcel.
 *
 * Non-retryable (return `true`):
 *   - `InpostAmbiguousWriteException` — a non-idempotent write (an unmarked
 *     POST, e.g. `generateLabel`'s `POST /v1/organizations/{id}/shipments`)
 *     that failed with an ambiguous 5xx/network error and MAY have already
 *     committed. Checked before the generic `InpostNetworkException` branch
 *     below, since it IS one (subclass).
 *
 * Retryable, deliberately left out (return `false`):
 *   - `InpostNetworkException` for anything else — genuinely transient
 *     (5xx/timeout on an idempotent call, or the retry budget itself
 *     exhausted on an idempotent read) and MUST keep retrying.
 *   - `InpostUnauthorizedException` (401/403) — routed through the separate
 *     `InpostAuthFailureClassifierAdapter` / `authFailureClassifierRegistry`
 *     (#819 / ADR-008), which flips the connection to `needs_reauth`.
 *     Classifying it here too would pre-empt that path (the
 *     `PrestashopRetryClassifierAdapter` precedent for the identical rule).
 *   - `ShippingProviderRejectionException` — a deterministic 4xx rejection
 *     from ShipX; not this classifier's concern (no shipped consumer
 *     currently reclassifies it, and it is not ambiguous).
 *   - Anything not recognized — default-retryable.
 *
 * @module libs/integrations/inpost/src/infrastructure/adapters
 * @implements {RetryClassifierPort}
 */
import type { RetryClassifierPort } from '@openlinker/core/sync';
import { InpostAmbiguousWriteException } from '../../domain/exceptions/inpost-ambiguous-write.exception';

export class InpostRetryClassifierAdapter implements RetryClassifierPort {
  isNonRetryable(cause: unknown): boolean {
    return cause instanceof InpostAmbiguousWriteException;
  }
}
