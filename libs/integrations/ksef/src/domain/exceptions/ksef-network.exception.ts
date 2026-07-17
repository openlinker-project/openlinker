/**
 * KSeF Network Exception
 *
 * Thrown for a transient transport failure against the KSeF API — DNS/TLS
 * failure, connection refused, request timeout/abort, or a refresh attempt that
 * could not reach the auth endpoint. Mirrors the Allegro precedent (#499):
 * surfaced as a RETRYABLE error so the worker's retry classifier backs off and
 * retries rather than marking the job dead, which is reserved for a genuine
 * `KsefAuthenticationException` (credential rejection).
 *
 * Never carries credential material in its message.
 *
 * @module libs/integrations/ksef/src/domain/exceptions
 */
export class KsefNetworkException extends Error {
  /**
   * True when the failure is a POST-REQUEST read timeout / abort — the request
   * was fully sent and we stopped waiting for the response, so it is AMBIGUOUS
   * whether KSeF received and processed the document. Distinct from a pre-receipt
   * connection failure (DNS/TLS/connection-refused), where the request provably
   * never landed. Consumed by `isKsefUnavailable` (#1585 F5): a receipt-ambiguous
   * failure must NOT enter the auto-resubmit offline window (double-issue risk) —
   * it routes to `in-doubt` for manual reconciliation instead.
   */
  public readonly receiptAmbiguous: boolean;

  constructor(
    message: string,
    public readonly url?: string,
    options?: { cause?: Error; receiptAmbiguous?: boolean },
  ) {
    super(message);
    this.name = 'KsefNetworkException';
    this.receiptAmbiguous = options?.receiptAmbiguous ?? false;
    if (options?.cause) {
      this.cause = options.cause;
    }
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KsefNetworkException);
    }
  }
}
