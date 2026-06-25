/**
 * KSeF Unsupported Document Type Exception
 *
 * Thrown when an `issueInvoice` command requests a neutral `DocumentType` the
 * KSeF adapter does not support. `DocumentType` is open-world at the core
 * boundary (#576) — the adapter advertises only the subset it can issue via
 * `getSupportedDocumentTypes` (today: `invoice`, `corrected`). Any other
 * requested type is a terminal, non-retryable input error: the adapter refuses
 * to emit a wrong document and raises this so the core `InvoiceService` (#1118)
 * maps it to a failed `InvoiceRecord` rather than producing an incorrect filing.
 *
 * @module libs/integrations/ksef/src/domain/exceptions
 */
export class KsefUnsupportedDocumentTypeException extends Error {
  constructor(
    /** The unsupported document type the command requested. */
    public readonly requestedDocumentType: string,
    /** The neutral document types the adapter can issue. */
    public readonly supportedDocumentTypes: readonly string[],
  ) {
    super(
      `KSeF adapter does not support document type: ${requestedDocumentType}. ` +
        `Supported types: ${supportedDocumentTypes.join(', ')}`,
    );
    this.name = 'KsefUnsupportedDocumentTypeException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KsefUnsupportedDocumentTypeException);
    }
  }
}
