/**
 * KSeF Retry Classifier Adapter
 *
 * Implements `RetryClassifierPort` (#581) for the KSeF platform — answers the
 * worker runner's "is this error non-retryable?" question for KSeF's own
 * exception hierarchy. Without this, the worker registry defaults every unknown
 * error to retryable, so a terminal failure (a deterministic 4xx, a rejected
 * session, an FA(3) build/validation fault, an unsupported document type) would
 * be retried until the job dies — burning worker capacity and masking the real
 * cause. Self-registered by the KSeF plugin's `register(host)` against
 * `RetryClassifierRegistryService`.
 *
 * Non-retryable cases (return `true`):
 *   - `KsefSessionException` — a processed session that cleared zero invoices,
 *     a missing reference, or a success-without-KSeF-number is a terminal
 *     business failure; re-issuing the same session never helps.
 *   - `KsefUnsupportedDocumentTypeException` — a deterministic input rejection.
 *   - `KsefApiException` with a deterministic 4xx `statusCode` (NOT 429) — e.g.
 *     400 / 403 / 404 / 409 / 415 / 422: retrying burns capacity.
 *   - `Fa3BuildException` (incl. `UnmappedTaxRateException`,
 *     `InvalidBuyerIdentificationException`, `UnsupportedCurrencyException`) and
 *     `Fa3XsdValidationException` — a malformed document is deterministic; the
 *     same input rebuilds to the same fault.
 *
 * Retryable cases intentionally left out (return `false`):
 *   - `KsefNetworkException` — network-level failure (DNS / TLS / connection
 *     refused / `fetch failed`). Always transient; the runner MUST retry.
 *   - `KsefApiException` with `429` (rate limit) or a 5xx — transient; the HTTP
 *     client already backs off on 429 and the runner gives more attempts.
 *   - Anything not recognized — default-retryable.
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 * @implements {RetryClassifierPort}
 */
import type { RetryClassifierPort } from '@openlinker/core/sync';
import { KsefApiException } from '../../domain/exceptions/ksef-api.exception';
import { KsefSessionException } from '../../domain/exceptions/ksef-session.exception';
import { KsefUnsupportedDocumentTypeException } from '../../domain/exceptions/ksef-unsupported-document-type.exception';
import { KsefInvalidCorrectionException } from '../../domain/exceptions/ksef-invalid-correction.exception';
import { Fa3BuildException } from '../../domain/exceptions/fa3-builder.exception';
import { Fa3XsdValidationException } from '../../domain/exceptions/fa3-validation.exception';
// The content-rejection status set is factored into the shared availability
// module (#1701) so the retry classifier and `isKsefUnavailable` can never
// drift on which 4xx are terminal versus which failures are a transient outage.
import { NON_RETRYABLE_KSEF_STATUS_CODES } from './ksef-availability';

export class KsefRetryClassifierAdapter implements RetryClassifierPort {
  isNonRetryable(cause: unknown): boolean {
    if (
      cause instanceof KsefSessionException ||
      cause instanceof KsefUnsupportedDocumentTypeException ||
      cause instanceof KsefInvalidCorrectionException ||
      cause instanceof Fa3BuildException ||
      cause instanceof Fa3XsdValidationException
    ) {
      return true;
    }

    if (
      cause instanceof KsefApiException &&
      cause.statusCode !== undefined &&
      NON_RETRYABLE_KSEF_STATUS_CODES.has(cause.statusCode)
    ) {
      return true;
    }

    // KsefNetworkException, 429, 5xx, and anything unrecognized → retryable.
    return false;
  }
}
