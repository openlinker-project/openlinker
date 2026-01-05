/**
 * Connection Not Found Exception
 *
 * Domain exception thrown when a connection with the specified ID does not exist.
 * This error is thrown by the repository when attempting to access, update, or
 * disable a non-existent connection.
 *
 * @module libs/core/src/identifier-mapping/domain/exceptions
 */
export class ConnectionNotFoundException extends Error {
  constructor(connectionId: string) {
    super(`Connection not found: ${connectionId}`);
    this.name = 'ConnectionNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}




