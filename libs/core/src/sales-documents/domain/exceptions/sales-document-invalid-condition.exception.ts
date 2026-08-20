/**
 * Sales-Document Invalid Condition Exception (#2170, review finding 2)
 *
 * Raised at WRITE time (creating a rule) when a `conditions` entry does not
 * satisfy {@link isSalesDocumentCondition} — e.g. an `orderCountry` condition
 * with an empty `value`, or an `orderTotalGross` condition with no
 * `thresholdRef`. The HTTP DTO layer (`apps/api/src/sales-documents/http/dto`)
 * already rejects these shapes before they reach this service; this guard is
 * defense-in-depth so a malformed condition can never persist as an
 * unconditional "match everything" rule, regardless of caller.
 *
 * @module libs/core/src/sales-documents/domain/exceptions
 */
export class SalesDocumentInvalidConditionException extends Error {
  constructor(public readonly conditionIndex: number) {
    super(`Sales-document rule condition at index ${conditionIndex} is malformed.`);
    this.name = 'SalesDocumentInvalidConditionException';
    Error.captureStackTrace(this, this.constructor);
  }
}
