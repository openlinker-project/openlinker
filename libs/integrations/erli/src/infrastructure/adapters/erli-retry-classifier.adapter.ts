/**
 * Erli Retry Classifier Adapter
 *
 * Implements `RetryClassifierPort` for Erli — answers the sync runner's "is
 * this error non-retryable?" for Erli's exception hierarchy. Registered against
 * `RetryClassifierRegistryService` in `createErliPlugin().register(host)` (#984;
 * the #981 exception docblocks assign this here).
 *
 * Non-retryable (`true`):
 *   - `ErliApiException` — the #981 client raises this ONLY for a deterministic
 *     4xx other than 401/403/429 (those are their own classes), so retrying
 *     never helps.
 *   - `ErliAuthenticationException` (401/403) — a revoked/invalid static key;
 *     retrying burns capacity. Surfaced as `needs_reauth` by the auth-failure
 *     classifier, not retried.
 *
 * Retryable (`false`, default): `ErliNetworkException` (transient transport)
 * and `ErliRateLimitException` (429 — handled with Retry-After in the client),
 * plus anything unrecognized.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 * @implements {RetryClassifierPort}
 */
import type { RetryClassifierPort } from '@openlinker/core/sync';
import { ErliApiException } from '../../domain/exceptions/erli-api.exception';
import { ErliAuthenticationException } from '../../domain/exceptions/erli-authentication.exception';

export class ErliRetryClassifierAdapter implements RetryClassifierPort {
  isNonRetryable(cause: unknown): boolean {
    return cause instanceof ErliApiException || cause instanceof ErliAuthenticationException;
  }
}
