/**
 * KSeF Exchange-Rate Exception
 *
 * Raised when the NBP average rate required for the art. 106e ust. 11 PLN/VAT
 * conversion of a foreign-currency invoice cannot be resolved — a network
 * failure, a non-404 HTTP error, a malformed NBP response, or a currency
 * published in neither table A nor table B. Thrown before any KSeF session is opened, so the
 * core `InvoiceService` marks the record failed rather than emitting a
 * non-compliant (conversion-less) foreign-currency document — compliance over
 * availability. Carries only the neutral currency + reason, never buyer PII or
 * credential material (ADR-026: PL/KSeF specifics stay in this package).
 *
 * @module libs/integrations/ksef/src/domain/exceptions
 */
export class KsefExchangeRateException extends Error {
  /**
   * Read STRUCTURALLY by the core `InvoiceService` (#1200). The rate is
   * resolved before any KSeF session opens, so nothing reached KSeF and a
   * re-attempt is always safe - whether the cause was a network hiccup or a
   * currency NBP does not publish.
   */
  readonly failureMode = 'rejected' as const;

  constructor(
    message: string,
    /**
     * `true` when re-asking NBP cannot change the answer (the currency is in
     * neither table A nor table B, or the input was malformed). The retry
     * classifier stops the job then; a network or HTTP failure stays retryable.
     */
    readonly deterministic: boolean = false,
  ) {
    super(message);
    this.name = 'KsefExchangeRateException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KsefExchangeRateException);
    }
  }
}
