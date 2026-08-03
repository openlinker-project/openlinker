/**
 * Analytics Consent Required Exception
 *
 * Thrown when a demo-mode registration arrives without accepting session
 * recording (#1938). On a demo instance recording is a condition of holding an
 * account: the registration form discloses it and creating the account accepts
 * it, so a payload carrying `false` did not come from that form. The DTO alone
 * cannot express "must be true", and a client that skips the form entirely must
 * still be rejected.
 *
 * @module libs/core/src/users/domain/exceptions
 */

export class AnalyticsConsentRequiredException extends Error {
  constructor() {
    super('Demo accounts must accept session recording');
    this.name = 'AnalyticsConsentRequiredException';
    Error.captureStackTrace(this, this.constructor);
  }
}
