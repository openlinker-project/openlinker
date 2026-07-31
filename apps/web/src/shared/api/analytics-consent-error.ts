/**
 * Analytics Consent Error
 *
 * Recognises the 403 the API's global `AnalyticsConsentGuard` raises when a
 * demo account has not consented to session recording (#1938). Keyed on the
 * machine-readable `code` rather than the message text, so copy edits on either
 * side cannot break the redirect.
 *
 * The literal is duplicated from `ANALYTICS_CONSENT_REQUIRED_CODE` in
 * `apps/api/src/auth/guards/analytics-consent.guard.ts` — the browser and the
 * API share no package, so the string is the contract. Renaming the code means
 * editing BOTH sites; nothing links them at compile time.
 *
 * @module shared/api
 */
import { ApiError } from './api-error';

export const ANALYTICS_CONSENT_REQUIRED_CODE = 'ANALYTICS_CONSENT_REQUIRED';

export function isAnalyticsConsentRequiredError(error: unknown): boolean {
  if (!(error instanceof ApiError) || !error.isForbidden()) {
    return false;
  }
  const { details } = error;
  return (
    typeof details === 'object' &&
    details !== null &&
    'code' in details &&
    details.code === ANALYTICS_CONSENT_REQUIRED_CODE
  );
}
