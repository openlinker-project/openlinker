/**
 * Operational Settings Domain Exceptions
 *
 * Raised by `OperationalSettingsService` on a write that breaks a bound, and
 * mapped to HTTP 400 at the controller (the `InvalidReportingCurrencyError`
 * precedent - core never constructs a NestJS exception).
 *
 * @module libs/core/src/operational-settings/domain/exceptions
 */

import type { OperationalSettingRule } from '../types/operational-settings.types';

export class InvalidOperationalSettingError extends Error {
  constructor(
    public readonly field: string,
    message: string,
    /** Which rule the value broke (#3866), so a client can phrase it. */
    public readonly rule?: OperationalSettingRule,
    /** The bound that rule names, when it has one. */
    public readonly limit?: number
  ) {
    super(message);
    this.name = 'InvalidOperationalSettingError';
    Error.captureStackTrace(this, this.constructor);
  }
}
