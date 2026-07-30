/**
 * Skip Analytics Consent Decorator
 *
 * Marks a controller method or class as exempt from the global
 * AnalyticsConsentGuard (#1938). Reserved for the handful of routes a
 * consent-less demo account must still be able to call: reading its own
 * session, giving consent, refreshing its token, signing out, and reading the
 * public system config the frontend boots from. Without these exemptions the
 * guard would block the very calls that resolve the missing consent.
 *
 * Mirrors the `@Public()` decorator shape (`SetMetadata` + `Reflector` lookup).
 *
 * @module apps/api/src/auth/decorators
 */
import type { CustomDecorator } from '@nestjs/common';
import { SetMetadata } from '@nestjs/common';

export const SKIP_ANALYTICS_CONSENT_KEY = 'skipAnalyticsConsent';
export const SkipAnalyticsConsent = (): CustomDecorator<string> =>
  SetMetadata(SKIP_ANALYTICS_CONSENT_KEY, true);
