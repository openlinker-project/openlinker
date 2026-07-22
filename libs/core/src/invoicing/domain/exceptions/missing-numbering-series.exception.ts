/**
 * Missing Numbering Series Exception
 *
 * Domain error raised when a `DocumentNumberConsumer` connection tries to issue a
 * document but has no numbering series assigned (#1575). Actionable: the operator
 * must configure a series on the connection before issuing. The provider is never
 * contacted — the failure is caught in core before crossing the boundary.
 *
 * @module libs/core/src/invoicing/domain/exceptions
 */
export class MissingNumberingSeriesException extends Error {
  constructor(connectionId: string) {
    super(
      `No invoice numbering series is configured for connection ${connectionId}. ` +
        'Configure a numbering series before issuing documents on this connection.',
    );
    this.name = 'MissingNumberingSeriesException';
    Error.captureStackTrace(this, this.constructor);
  }
}
