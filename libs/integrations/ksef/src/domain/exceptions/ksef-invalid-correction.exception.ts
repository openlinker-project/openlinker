/**
 * KSeF Invalid-Correction Exception
 *
 * Thrown when the neutral `IssueInvoiceCommand`/`IssueCorrectionCommand` is
 * internally inconsistent or incomplete about describing a correction:
 * `documentType==='corrected'` but no `correction` payload, a `correction`
 * payload present without `documentType==='corrected'`, a missing
 * `originalDocument` snapshot (#1288), or an out-of-range `originalLineNumber`
 * (#1288). The FA(3) builder keys KOR emission off `correction !== undefined`
 * (not the document type), so an inconsistent command would silently emit a
 * plain invoice for a "corrected" type (or a KOR for a plain type). This is a
 * deterministic, terminal command-contract violation — the provider definitely
 * created NO document, so re-attempting the SAME command never helps, but
 * fixing the input and retrying is safe (unlike a transport/indeterminate
 * failure). `failureMode = 'rejected'` (#1200) is the neutral discriminator the
 * core `InvoiceService` reads STRUCTURALLY to classify it as such, rather than
 * falling back to the fiscal-safe `'in-doubt'` default for an unmarked throwable.
 *
 * @module libs/integrations/ksef/src/domain/exceptions
 */
export class KsefInvalidCorrectionException extends Error {
  /**
   * Neutral failure discriminator the core `InvoiceService` reads STRUCTURALLY
   * (#1200) — core never value-imports this class. Mirrors the same structural
   * contract as Subiekt's `SubiektInvoiceRejectedError`.
   */
  readonly failureMode = 'rejected' as const;

  constructor(message: string) {
    super(message);
    this.name = 'KsefInvalidCorrectionException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KsefInvalidCorrectionException);
    }
  }
}
