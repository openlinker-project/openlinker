/**
 * Demo Types
 *
 * Consent to demo session recording lives on the account and arrives on the
 * session (#1743, #1938) — no browser-side consent state is left. The old
 * `openlinker.demoAnalyticsConsent` key, its same-tab change event, and its
 * `accepted | declined` union are gone: they existed only because consent used
 * to be an anonymous pre-login banner choice with nowhere else to live, and they
 * had become a second source of truth able to disagree with the database.
 */

/**
 * Per-tab de-dup flag for the consent-independent `captureMarketingLanding`
 * marketing-UTM capture. Session-scoped (not localStorage) — a fresh tab
 * re-evaluates the landing URL, but repeated renders within the same tab
 * don't re-fire.
 */
export const MARKETING_LANDING_CAPTURED_STORAGE_KEY = 'openlinker.marketingLandingCaptured';
