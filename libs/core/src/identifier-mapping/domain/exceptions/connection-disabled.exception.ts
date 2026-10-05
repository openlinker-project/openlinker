/**
 * Connection Disabled Exception
 *
 * Domain exception thrown when attempting to use a connection that has been
 * disabled. This error is thrown by services when a connection is required
 * for an operation but its status is 'disabled' - or 'archived' (#3657), which
 * is a disabled connection with its credential removed and the same refusal.
 *
 * @module libs/core/src/identifier-mapping/domain/exceptions
 */
export class ConnectionDisabledException extends Error {
  constructor(connectionId: string, status: 'disabled' | 'archived' = 'disabled') {
    super(`Connection is ${status}: ${connectionId}`);
    this.name = 'ConnectionDisabledException';
    Error.captureStackTrace(this, this.constructor);
  }
}







