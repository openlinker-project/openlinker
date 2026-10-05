/**
 * Access-denied error recognition (#3096)
 *
 * A 403 that means "this session's role may not do this" — the case a page
 * answers with `AccessDeniedState` rather than with an error card and a Retry
 * that cannot succeed.
 *
 * The demo-consent 403 is deliberately EXCLUDED: it is not a permission fact
 * but a precondition the account can satisfy, and it already has its own
 * global redirect (`app-providers.tsx`). Rendering "you don't have access" for
 * it would tell a demo visitor something false.
 *
 * A file of its own rather than a method on `ApiError`: the consent check
 * imports `ApiError`, so putting this beside the class would make the two
 * modules import each other.
 *
 * @module shared/api
 */
import { isAnalyticsConsentRequiredError } from './analytics-consent-error';
import { ApiError } from './api-error';

export function isAccessDeniedError(error: unknown): boolean {
  return (
    error instanceof ApiError && error.isForbidden() && !isAnalyticsConsentRequiredError(error)
  );
}
