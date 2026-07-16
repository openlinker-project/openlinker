/**
 * KSeF Availability Discrimination
 *
 * Single source of truth for classifying a KSeF failure as a genuine
 * "KSeF-unavailable" outage signal versus a deterministic content/validation
 * rejection (#1701, mini-epic #1585, ADR-035). Two consumers depend on this
 * discrimination and MUST NOT drift apart:
 *
 *  - `KsefInvoicingAdapter.issueInvoice` uses `isKsefUnavailable` to decide
 *    whether a failed session open/submit falls into the neutral offline
 *    (`pending-submission`) window instead of throwing terminally.
 *  - `KsefRetryClassifierAdapter` uses `NON_RETRYABLE_KSEF_STATUS_CODES` to
 *    decide which HTTP 4xx are terminal (never retried).
 *
 * The content-rejection status set lives here so both consumers share it. The
 * two verdicts are disjoint by construction: a code is either a content
 * rejection (terminal, `NON_RETRYABLE_KSEF_STATUS_CODES`) or a transient
 * outage signal (`isTransientKsefStatusCode`), never both — so an error that
 * `isKsefUnavailable` accepts can never be classified non-retryable, and the
 * offline path and the retry path can never contradict each other.
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 */
import { KsefApiException } from '../../domain/exceptions/ksef-api.exception';
import { KsefNetworkException } from '../../domain/exceptions/ksef-network.exception';

/**
 * Deterministic KSeF 4xx content/validation status codes — retrying never helps
 * and they are NOT an outage signal. Shared with the retry classifier so the
 * terminal-vs-transient boundary is single-sourced.
 *
 * Excludes:
 *   - 401 (raised as `KsefAuthenticationException`, handled via reauth).
 *   - 408 / 425 (transient by spec).
 *   - 429 (rate limit — transient; see `isTransientKsefStatusCode`).
 */
export const NON_RETRYABLE_KSEF_STATUS_CODES: ReadonlySet<number> = new Set([
  400, 403, 404, 405, 409, 415, 422,
]);

/**
 * True when an HTTP status code signals a transient KSeF-unavailable condition:
 * `429` (rate limit) or any `5xx` (server-side outage). Disjoint from
 * `NON_RETRYABLE_KSEF_STATUS_CODES`.
 */
export function isTransientKsefStatusCode(statusCode: number): boolean {
  return statusCode === 429 || (statusCode >= 500 && statusCode <= 599);
}

/**
 * True when `error` is a genuine KSeF-unavailable signal: a network-level
 * failure (`KsefNetworkException` — DNS / TLS / connection refused / timeout) or
 * a `KsefApiException` carrying a transient status code (`429` / `5xx`).
 *
 * False for every content/validation rejection — `KsefSessionException`,
 * `Fa3XsdValidationException`, a `KsefApiException` in the 4xx content set, and
 * anything unrecognised. Only a TRUE verdict is allowed to enter the offline
 * (`pending-submission`) window: a content rejection can never clear on
 * resubmit, so it must fail terminally (fiscal safety).
 */
export function isKsefUnavailable(error: unknown): boolean {
  if (error instanceof KsefNetworkException) {
    return true;
  }
  if (error instanceof KsefApiException && error.statusCode !== undefined) {
    return isTransientKsefStatusCode(error.statusCode);
  }
  return false;
}
