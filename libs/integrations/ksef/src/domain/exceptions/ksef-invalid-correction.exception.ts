/**
 * KSeF Invalid-Correction Exception
 *
 * Thrown when the neutral `IssueInvoiceCommand` is internally inconsistent about
 * whether it describes a correction: `documentType==='corrected'` but no
 * `correction` payload, or a `correction` payload present without
 * `documentType==='corrected'`. The FA(3) builder keys KOR emission off
 * `correction !== undefined` (not the document type), so an inconsistent command
 * would silently emit a plain invoice for a "corrected" type (or a KOR for a
 * plain type). This is a deterministic, terminal command-contract violation — the
 * core `InvoiceService` maps it to a failed record; retrying the same command
 * never helps (the retry classifier marks it non-retryable).
 *
 * @module libs/integrations/ksef/src/domain/exceptions
 */
export class KsefInvalidCorrectionException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KsefInvalidCorrectionException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KsefInvalidCorrectionException);
    }
  }
}
