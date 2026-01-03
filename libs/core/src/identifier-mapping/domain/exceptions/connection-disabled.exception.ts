/**
 * Connection Disabled Exception
 *
 * Domain exception thrown when attempting to use a connection that has been
 * disabled. This error is thrown by services when a connection is required
 * for an operation but its status is 'disabled'.
 *
 * @module libs/core/src/identifier-mapping/domain/exceptions
 */
export class ConnectionDisabledException extends Error {
  constructor(connectionId: string) {
    super(`Connection is disabled: ${connectionId}`);
    this.name = 'ConnectionDisabledException';
    Error.captureStackTrace(this, this.constructor);
  }
}



