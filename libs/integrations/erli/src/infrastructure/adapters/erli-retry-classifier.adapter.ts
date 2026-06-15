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
 * `ErliConfigException` is also non-retryable: it signals a deterministic
 * programmer/config error raised before any request leaves the client (bad
 * `baseUrl`/host escape, or a hostile product id failing the `productPath`
 * allowlist). Retrying re-throws the same error every attempt, so it must fail
 * fast instead of burning the whole retry budget (review #1058).
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 * @implements {RetryClassifierPort}
 */
import type { RetryClassifierPort } from '@openlinker/core/sync';
import { ErliApiException } from '../../domain/exceptions/erli-api.exception';
import { ErliAuthenticationException } from '../../domain/exceptions/erli-authentication.exception';
import { ErliConfigException } from '../../domain/exceptions/erli-config.exception';

export class ErliRetryClassifierAdapter implements RetryClassifierPort {
  isNonRetryable(cause: unknown): boolean {
    return (
      cause instanceof ErliApiException ||
      cause instanceof ErliAuthenticationException ||
      cause instanceof ErliConfigException
    );
  }
}
