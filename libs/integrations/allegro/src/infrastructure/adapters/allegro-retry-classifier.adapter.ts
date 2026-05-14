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
