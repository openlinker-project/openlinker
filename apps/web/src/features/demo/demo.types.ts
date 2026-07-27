/**
 * Demo Types
 *
 * Visitor consent for demo-only analytics (PostHog session recording) is a
 * client-owned preference persisted to localStorage, mirroring the theme
 * preference in `shared/theme/theme.types.ts`.
 */

export const DEMO_ANALYTICS_CONSENT_STORAGE_KEY = 'openlinker.demoAnalyticsConsent';

/**
 * Same-tab change notification for the consent key (#1882). The native
 * `storage` event only fires in OTHER tabs, so the settings toggle and the
 * AppShell demo banner — both mounted in the same document — would otherwise
 * disagree until reload.
 */
export const DEMO_ANALYTICS_CONSENT_CHANGE_EVENT = 'openlinker:demo-analytics-consent-change';

export const DemoAnalyticsConsentValues = ['accepted', 'declined'] as const;
export type DemoAnalyticsConsent = (typeof DemoAnalyticsConsentValues)[number];
