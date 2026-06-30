/**
 * Registration Disabled Exception
 *
 * Thrown when a registration attempt is made while self-service registration
 * is disabled for the installation (OL_REGISTRATION_ENABLED != 'true').
 *
 * @module libs/core/src/users/domain/exceptions
 */

export class RegistrationDisabledException extends Error {
  constructor() {
    super('Registration is disabled for this installation');
    this.name = 'RegistrationDisabledException';
    Error.captureStackTrace(this, this.constructor);
  }
}
