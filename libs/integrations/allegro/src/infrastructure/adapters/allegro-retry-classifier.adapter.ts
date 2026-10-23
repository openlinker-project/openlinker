/**
 * Allegro Retry Classifier Adapter
 *
 * Implements `RetryClassifierPort` (#581) for the Allegro platform — answers
 * the runner's "is this error non-retryable?" question for Allegro's own
 * exception hierarchy. Self-registered by `AllegroIntegrationModule.onModuleInit`
 * against `RetryClassifierRegistryService` alongside the adapter factory and
 * connection tester.
 *
 * Non-retryable cases (return `true`):
 *   - `AllegroAuthenticationException` (401) — needs token refresh, not retry.
 *   - `AllegroApiException` with a status in `NON_RETRYABLE_STATUS_CODES` —
 *     deterministic 4xx (e.g., 415 unsupported content type, 422 validation)
 *     where retrying burns worker capacity and masks the real issue.
 *   - `AllegroAmbiguousWriteException` (#3469 IMPORTANT-1 review) — a
 *     non-idempotent write (POST/PATCH, no `idempotent: true`) that failed
 *     with an ambiguous 5xx/network error and MAY have already committed.
 *     `AllegroHttpClient` already refuses to retry it internally; classifying
 *     it as non-retryable here too is what stops `SyncJobRunner` from
 *     re-running the whole job and re-sending the same POST — checked
 *     BEFORE the generic `AllegroApiException` status-code test below, since
 *     it IS one (subclass) and must not fall through to the retryable
 *     default for an ambiguous (non-4xx) status.
 *
 * Retryable cases intentionally left out (return `false`):
 *   - `AllegroApiException` with 5xx / 408 / 425 — transient; the HTTP client
 *     already retries internally, and the runner gives the job more attempts.
 *   - `AllegroNetworkException` — network-level failure during token refresh
 *     or API request (DNS / TLS / connection refused / `TypeError: fetch
 *     failed`). Always transient: the runner MUST retry with backoff. Do
 *     NOT add this class to the non-retryable set — pre-#499 these failures
 *     were swallowed by `refreshOnUnauthorized` and re-classified as
 *     `AllegroAuthenticationException`, killing jobs on attempt 1/10 the
 *     moment `auth.allegro.pl` had a 1-second blip.
 *   - 429 — raised as `AllegroRateLimitException` and handled with
 *     Retry-After inside the HTTP client.
 *   - Anything not recognized — default-retryable.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 * @implements {RetryClassifierPort}
 */
import type { RetryClassifierPort } from '@openlinker/core/sync';
import { AllegroApiException } from '../../domain/exceptions/allegro-api.exception';
import { AllegroAuthenticationException } from '../../domain/exceptions/allegro-authentication.exception';
import { AllegroAmbiguousWriteException } from '../../domain/exceptions/allegro-ambiguous-write.exception';

/**
 * Deterministic Allegro 4xx status codes — retrying never helps.
 *
 * Excludes:
 *   - 401 (handled separately via `AllegroAuthenticationException` + token refresh)
 *   - 408 / 425 (transient by spec)
 *   - 429 (raised as `AllegroRateLimitException` with Retry-After in the HTTP client)
 */
const NON_RETRYABLE_STATUS_CODES: ReadonlySet<number> = new Set([
  400, 403, 404, 405, 409, 415, 422,
]);

export class AllegroRetryClassifierAdapter implements RetryClassifierPort {
  isNonRetryable(cause: unknown): boolean {
    // AllegroAuthenticationException extends Error directly (not
    // AllegroApiException), so the two branches are disjoint: a 401 never
    // reaches the status-code check below.
    if (cause instanceof AllegroAuthenticationException) {
      return true;
    }

    // Checked before the generic AllegroApiException branch — an ambiguous
    // write's status is typically undefined (network) or >=500, neither of
    // which NON_RETRYABLE_STATUS_CODES lists, so it would otherwise fall
    // through to the retryable default.
    if (cause instanceof AllegroAmbiguousWriteException) {
      return true;
    }

    if (
      cause instanceof AllegroApiException &&
      cause.statusCode !== undefined &&
      NON_RETRYABLE_STATUS_CODES.has(cause.statusCode)
    ) {
      return true;
    }

    return false;
  }
}
