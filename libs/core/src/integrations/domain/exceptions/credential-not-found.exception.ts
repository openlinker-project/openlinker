/**
 * Credential Not Found Exception
 *
 * Domain exception thrown when a credential with the specified reference does not exist.
 * This error is thrown by the repository when attempting to access, update, or delete
 * a non-existent credential.
 *
 * @module libs/core/src/integrations/domain/exceptions
 */
export class CredentialNotFoundException extends Error {
  constructor(public readonly ref: string) {
    super(`Credential not found: ${ref}`);
    this.name = 'CredentialNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}



