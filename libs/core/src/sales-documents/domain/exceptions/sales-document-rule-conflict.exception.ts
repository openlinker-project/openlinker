/**
 * Sales-Document Rule Conflict Exception (#2170)
 *
 * Raised by the write-path conflict guard when a new/updated rule shares its
 * `(country, conditionsHash)` with an existing rule whose effective date
 * range overlaps AND which points at a DIFFERENT connection. Deliberately no
 * `priority` field resolves this — see the guard's own doc comment.
 *
 * Also raised at the repository layer for an exact SAME-connection duplicate
 * (#2184 review) — the `(country, conditionsHash, effectiveFrom)` unique
 * index doesn't distinguish by connection, so a same-connection re-save of
 * an identical rule reaches this same exception rather than a raw 500.
 *
 * @module libs/core/src/sales-documents/domain/exceptions
 */
export class SalesDocumentRuleConflictException extends Error {
  constructor(
    public readonly conflictingRuleId: string,
    public readonly conflictingConnectionId: string,
  ) {
    super(
      `A rule with the identical conditions already routes this country to connection ` +
        `'${conflictingConnectionId}' (rule '${conflictingRuleId}') during an overlapping period. ` +
        `OpenLinker cannot pick between them by save order — edit the existing rule instead.`,
    );
    this.name = 'SalesDocumentRuleConflictException';
    Error.captureStackTrace(this, this.constructor);
  }
}
