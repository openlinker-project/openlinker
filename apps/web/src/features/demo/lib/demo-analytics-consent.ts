/**
 * Demo Analytics Consent
 *
 * Reads/writes the visitor's opt-in choice for demo-only analytics (PostHog
 * session recording) to localStorage. Fails safe: if storage is unavailable
 * (private browsing, strict cookie policy), consent reads as unset so the
 * visitor is re-prompted rather than silently enabling recording.
 */
import {
  DEMO_ANALYTICS_CONSENT_STORAGE_KEY,
  DemoAnalyticsConsentValues,
  type DemoAnalyticsConsent,
} from '../demo.types';

function isDemoAnalyticsConsent(value: unknown): value is DemoAnalyticsConsent {
  return (
    typeof value === 'string' && DemoAnalyticsConsentValues.includes(value as DemoAnalyticsConsent)
  );
}

export function getDemoAnalyticsConsent(): DemoAnalyticsConsent | null {
  try {
    const raw = window.localStorage.getItem(DEMO_ANALYTICS_CONSENT_STORAGE_KEY);
    return isDemoAnalyticsConsent(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Persists the consent choice. Returns `true` when it was written, `false`
 * when localStorage is unavailable (private browsing, strict cookie policy).
 * Callers use the result to keep their in-memory state in step with what the
 * consent-gated loader (`initDemoIntegrations`, which re-reads localStorage)
 * will actually see — otherwise "accepted" could be shown while analytics
 * silently stays off.
 */
export function setDemoAnalyticsConsent(value: DemoAnalyticsConsent): boolean {
  try {
    window.localStorage.setItem(DEMO_ANALYTICS_CONSENT_STORAGE_KEY, value);
    return true;
  } catch {
    // localStorage may be disabled — the visitor will simply be re-prompted
    // next time; no functional impact beyond that.
    return false;
  }
}
