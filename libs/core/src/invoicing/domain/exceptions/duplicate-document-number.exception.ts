/**
 * Duplicate Document Number Exception
 *
 * Domain error raised when persisting a rendered document number collides with a
 * last-line-of-defense unique index on `invoice_records`
 * (`UNIQUE(numberingSeriesId, documentNumber)` / `UNIQUE(connectionId,
 * documentNumber)`, #1575). Surfaces a `nextSeq` rollback / pattern edit that
 * re-rendered an already-issued number as a CLEAR domain error in OpenLinker
 * rather than letting the provider reject the document downstream. The repository
 * converts the Postgres unique-violation into this so the application layer never
 * sees `QueryFailedError`.
 *
 * @module libs/core/src/invoicing/domain/exceptions
 */
export class DuplicateDocumentNumberException extends Error {
  constructor(connectionId: string, documentNumber: string) {
    super(
      `Document number "${documentNumber}" has already been issued on connection ${connectionId}. ` +
        'This usually means the series nextSeq was lowered or the pattern was edited to re-produce an existing number.',
    );
    this.name = 'DuplicateDocumentNumberException';
    Error.captureStackTrace(this, this.constructor);
  }
}
