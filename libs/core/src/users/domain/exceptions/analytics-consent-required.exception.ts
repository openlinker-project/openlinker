/**
 * Analytics Consent Required Exception
 *
 * Thrown when a demo-mode registration arrives without consent to session
 * recording (#1938). On a demo instance consent is a condition of holding an
 * account, so the browser-side `z.literal(true)` check has a server-side
 * counterpart — the DTO alone cannot express "must be true", and a client that
 * skips the form entirely must still be rejected.
 *
 * @module libs/core/src/users/domain/exceptions
 */

export class AnalyticsConsentRequiredException extends Error {
  constructor() {
    super('Demo accounts require consent to session recording');
    this.name = 'AnalyticsConsentRequiredException';
    Error.captureStackTrace(this, this.constructor);
  }
}
