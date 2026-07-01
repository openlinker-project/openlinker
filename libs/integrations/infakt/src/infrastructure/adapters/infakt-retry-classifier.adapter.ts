/**
 * Infakt Retry Classifier Adapter
 *
 * Implements `RetryClassifierPort` for Infakt — answers the worker runner's
 * "is this error non-retryable?" question for Infakt's own exception
 * hierarchy (`InfaktApiError`). Without this the registry defaults every
 * unknown error to retryable, which is fiscally unsafe for a 5xx / network
 * failure that may have reached Infakt's servers before the response was
 * lost — Infakt could have already created the invoice (and possibly
 * submitted it to KSeF), so a blind retry risks a double-issued fiscal
 * document.
 *
 * Classification (fiscal-safety framing, mirrors `SubiektRetryClassifierAdapter`):
 *   - `4xx` except `429` (`InfaktApiError.isClientError()` minus rate-limit) —
 *     REJECTED. Terminal and deterministic: the request never became a
 *     document, so retrying the same job burns capacity for nothing. Safe for
 *     a human/business process to issue a corrected invoice afterwards, but
 *     that is a distinct concern from the runner's auto-retry decision.
 *   - `429` — TRANSIENT. Rate-limited; the runner should back off and retry.
 *   - `5xx` (`InfaktApiError.isServerError()`) — IN-DOUBT. The document may
 *     already exist on Infakt's side (and may already be mid-flight to
 *     KSeF); auto-retrying blind risks a double-issued fiscal document, so
 *     this is classified non-retryable until Infakt's API guarantees
 *     idempotency-key dedup on the write path.
 *
 * The registry OR-aggregates every registered classifier's answer with no
 * platform scoping (`RetryClassifierRegistryService.isNonRetryable`), so —
 * mirroring `SubiektRetryClassifierAdapter` / `KsefRetryClassifierAdapter` —
 * this classifier recognises ONLY `InfaktApiError` (its own exception type)
 * and abstains (`false`) for everything else, including a bare network /
 * transport failure that never became an `InfaktApiError` at all. A
 * catch-all `true` here would turn every sibling plugin's transient error
 * (and Infakt's own network blips) non-retryable.
 *
 * Self-registered by the Infakt plugin's `register(host)` against
 * `RetryClassifierRegistryService`.
 *
 * @module libs/integrations/infakt/src/infrastructure/adapters
 * @implements {RetryClassifierPort}
 */
import type { RetryClassifierPort } from '@openlinker/core/sync';
import { InfaktApiError } from '../../domain/exceptions/infakt-api.error';

export class InfaktRetryClassifierAdapter implements RetryClassifierPort {
  isNonRetryable(cause: unknown): boolean {
    if (!(cause instanceof InfaktApiError)) {
      // Not ours — abstain. Includes bare network/transport failures, which
      // never surface as InfaktApiError (only non-2xx HTTP responses do).
      return false;
    }

    if (cause.statusCode === 429) {
      // Transient rate-limit — retryable.
      return false;
    }
    if (cause.isClientError()) {
      // Deterministic 4xx rejection — terminal, non-retryable.
      return true;
    }
    // 5xx — IN-DOUBT: the document may already exist on Infakt's side.
    // Fiscal-safety pivot: non-retryable until Infakt guarantees
    // idempotency-key dedup on the write path.
    return true;
  }
}
