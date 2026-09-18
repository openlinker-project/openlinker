/**
 * EparagonyConfigException
 *
 * Raised when a connection cannot be turned into a working client at all -
 * missing credentials, an unusable host override - or when the sale as composed
 * cannot legally be expressed as the document being issued - a receipt or an
 * invoice - such as an unresolvable tax rate.
 *
 * `failureMode` is `'rejected'`: nothing crossed the provider boundary, so
 * nothing was registered and re-attempting after the operator fixes the
 * connection is safe.
 *
 * @module libs/integrations/eparagony/src/domain/exceptions
 */
import type { EparagonyFailureMode } from './eparagony-api.error';

export class EparagonyConfigException extends Error {
  readonly failureMode: EparagonyFailureMode = 'rejected';

  constructor(
    message: string,
    /**
     * Short, PII-free operator-facing summary.
     *
     * PERSISTED VERBATIM ON THE FISCALIZATION LANE ONLY.
     * `FiscalRegistrationService.deriveFailureReason` surfaces this text as-is;
     * `InvoiceService` does NOT - it matches this text against three marker
     * lists to pick a neutral `InvoiceFailureCode`, derives the operator's
     * sentence from that code, and then discards the text. So on the invoicing
     * lane an OL-authored reason that matches no marker reaches nothing, and an
     * invoice refusal that carries a remedy must repeat it in `message` (which
     * IS persisted, as `invoice_records.errorMessage`). The note above
     * `composeInvoiceDocument` in `eparagony-invoice.mapper.ts` records the fix.
     */
    readonly reason: string,
    readonly connectionId?: string,
  ) {
    super(message);
    this.name = 'EparagonyConfigException';
    Error.captureStackTrace(this, this.constructor);
  }
}
