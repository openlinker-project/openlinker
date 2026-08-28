/**
 * Operational Settings Domain Exceptions
 *
 * Raised by `OperationalSettingsService` on a write that breaks a bound, and
 * mapped to HTTP 400 at the controller (the `InvalidReportingCurrencyError`
 * precedent - core never constructs a NestJS exception).
 *
 * @module libs/core/src/operational-settings/domain/exceptions
 */

export class InvalidOperationalSettingError extends Error {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(message);
    this.name = 'InvalidOperationalSettingError';
    Error.captureStackTrace(this, this.constructor);
  }
}
