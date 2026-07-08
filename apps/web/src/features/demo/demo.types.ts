/**
 * Demo Types
 *
 * Visitor consent for demo-only analytics (PostHog session recording) is a
 * client-owned preference persisted to localStorage, mirroring the theme
 * preference in `shared/theme/theme.types.ts`.
 */

export const DEMO_ANALYTICS_CONSENT_STORAGE_KEY = 'openlinker.demoAnalyticsConsent';

export const DemoAnalyticsConsentValues = ['accepted', 'declined'] as const;
export type DemoAnalyticsConsent = (typeof DemoAnalyticsConsentValues)[number];
