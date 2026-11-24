/**
 * Login Page Settings Exceptions
 *
 * Raised when an admin write names an unknown field or language, or exceeds a
 * field's maximum length. `field` is the dotted path (`pl.headline`) so the API
 * can name it in the 400.
 *
 * @module libs/core/src/login-page-settings/domain/exceptions
 */
export class InvalidLoginPageSettingError extends Error {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(message);
    this.name = 'InvalidLoginPageSettingError';
    Error.captureStackTrace(this, this.constructor);
  }
}
