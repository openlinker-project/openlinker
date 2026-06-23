/**
 * KSeF Session Exception
 *
 * Thrown for a business-level failure of the online document session — the
 * session was opened and the document submitted, but KSeF rejected it. The
 * canonical case is session status `445` ("session closed with zero valid
 * invoices"): the FA(3) was structurally well-formed enough to submit but failed
 * KSeF's own validation, so the invoice was NOT issued. This is a terminal,
 * non-retryable outcome that the core `InvoiceService` (#1118) maps to a failed
 * `InvoiceRecord` — distinct from `KsefApiException` (a transport-level 4xx) and
 * `KsefAuthenticationException` (a credential rejection).
 *
 * `sessionStatusCode` carries the KSeF-native status (e.g. 445) for diagnostics
 * — it is a KSeF specific and never crosses back into the neutral core result
 * (ADR-026); the adapter raises this exception rather than returning a neutral
 * record so the failure is loud.
 *
 * @module libs/integrations/ksef/src/domain/exceptions
 */
export class KsefSessionException extends Error {
  constructor(
    message: string,
    /** KSeF-native session status code (e.g. 445 = closed with zero valid invoices). */
    public readonly sessionStatusCode?: number,
    /** Session reference number for traceability; carries no document content. */
    public readonly sessionReferenceNumber?: string,
  ) {
    super(message);
    this.name = 'KsefSessionException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KsefSessionException);
    }
  }
}
