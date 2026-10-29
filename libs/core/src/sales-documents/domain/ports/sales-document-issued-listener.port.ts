/**
 * Sales Document Issued Listener Port (#3554)
 *
 * "An order's ORIGINATING sales document was just issued" - told by the two
 * contexts that issue one (`invoicing` on an issued invoice, `fiscalization` on a
 * registered receipt) to whoever listens, today the orders context, which fires
 * the `order.document_issued` automation trigger.
 *
 * It lives here because both issuers already import this context and neither may
 * depend on `orders` (`InvoicingModule` must never import an orders token - the
 * one-way edge). The issuers resolve the binding lazily through `ModuleRef`
 * (`strict: false`), so a process with no listener bound skips it silently. A
 * correction is never an originating document and is never reported.
 *
 * @module libs/core/src/sales-documents/domain/ports
 */
import type { SalesDocumentKind } from '../types/sales-document-kind.types';

export interface SalesDocumentIssuedEvent {
  internalOrderId: string;
  documentKind: SalesDocumentKind;
  issuedAt: Date;
}

export interface SalesDocumentIssuedListenerPort {
  /** Best-effort: an implementation must not throw for a modelled condition. */
  onOriginatingDocumentIssued(event: SalesDocumentIssuedEvent): Promise<void>;
}
