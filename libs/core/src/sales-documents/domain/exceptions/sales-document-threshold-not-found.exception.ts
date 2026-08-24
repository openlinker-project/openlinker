/**
 * Sales-Document Threshold Not Found Exception (#2170)
 *
 * Raised when a rule's `orderTotalGross` condition references a
 * `thresholdRef` that does not exist in `sales_document_thresholds` — caught
 * at WRITE time (creating the rule), never silently accepted, since an
 * unresolvable threshold at evaluation time would make the condition
 * unevaluable rather than loudly wrong.
 *
 * @module libs/core/src/sales-documents/domain/exceptions
 */
export class SalesDocumentThresholdNotFoundException extends Error {
  constructor(public readonly thresholdRef: string) {
    super(`No sales-document threshold registered for ref '${thresholdRef}'.`);
    this.name = 'SalesDocumentThresholdNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}
