/**
 * KSeF Missing Document Number Exception
 *
 * Thrown when an `issueInvoice` command reaches the KSeF adapter without an
 * allocated document number (FA(3) `P_2`, #1575). KSeF is a
 * `DocumentNumberConsumer`: the core `InvoiceService` allocates the legal number
 * from the connection's numbering series and passes it as
 * `IssueInvoiceCommand.documentNumber`. A missing value is a wiring invariant
 * violation — the adapter refuses to emit a document with no legal number and
 * raises this terminally so the service records a failure instead.
 *
 * @module libs/integrations/ksef/src/domain/exceptions
 */
export class KsefMissingDocumentNumberException extends Error {
  constructor(orderId: string) {
    super(
      `KSeF issuance for order ${orderId} received no allocated document number (P_2). ` +
        'KSeF is an OpenLinker-numbered provider; the core InvoiceService must allocate one before issuing.',
    );
    this.name = 'KsefMissingDocumentNumberException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KsefMissingDocumentNumberException);
    }
  }
}
