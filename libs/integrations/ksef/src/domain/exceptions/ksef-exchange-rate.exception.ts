/**
 * KSeF Exchange-Rate Exception
 *
 * Raised when the NBP average rate required for the art. 106e ust. 11 PLN/VAT
 * conversion of a foreign-currency invoice cannot be resolved — a network
 * failure, a non-404 HTTP error, a malformed NBP response, or no rate published
 * within the walk-back window. Thrown before any KSeF session is opened, so the
 * core `InvoiceService` marks the record failed rather than emitting a
 * non-compliant (conversion-less) foreign-currency document — compliance over
 * availability. Carries only the neutral currency + reason, never buyer PII or
 * credential material (ADR-026: PL/KSeF specifics stay in this package).
 *
 * @module libs/integrations/ksef/src/domain/exceptions
 */
export class KsefExchangeRateException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KsefExchangeRateException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KsefExchangeRateException);
    }
  }
}
