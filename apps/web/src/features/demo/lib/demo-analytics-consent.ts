/**
 * Demo Analytics Consent
 *
 * Reads/writes the visitor's opt-in choice for demo-only analytics (PostHog
 * session recording) to localStorage. Fails safe: if storage is unavailable
 * (private browsing, strict cookie policy), consent reads as unset so the
 * visitor is re-prompted rather than silently enabling recording.
 */
import {
  DEMO_ANALYTICS_CONSENT_CHANGE_EVENT,
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
 *
 * A successful write also dispatches DEMO_ANALYTICS_CONSENT_CHANGE_EVENT so
 * same-tab listeners (the AppShell demo banner) re-read immediately; other
 * tabs pick the change up through the native `storage` event.
 */
export function setDemoAnalyticsConsent(value: DemoAnalyticsConsent): boolean {
  try {
    window.localStorage.setItem(DEMO_ANALYTICS_CONSENT_STORAGE_KEY, value);
  } catch {
    // localStorage may be disabled — the visitor will simply be re-prompted
    // next time; no functional impact beyond that.
    return false;
  }
  window.dispatchEvent(
    new CustomEvent<DemoAnalyticsConsent>(DEMO_ANALYTICS_CONSENT_CHANGE_EVENT, { detail: value }),
  );
  return true;
}

/**
 * Subscribes to consent changes from anywhere in the app: the same-tab custom
 * event above, plus the native cross-tab `storage` event scoped to our key.
 * Returns an unsubscribe function for `useEffect` cleanup.
 */
export function subscribeToDemoAnalyticsConsent(
  listener: (value: DemoAnalyticsConsent | null) => void,
): () => void {
  const handleLocalChange = (): void => listener(getDemoAnalyticsConsent());
  const handleStorage = (event: StorageEvent): void => {
    // `key === null` is a whole-store clear(), which also drops our value.
    if (event.key !== null && event.key !== DEMO_ANALYTICS_CONSENT_STORAGE_KEY) {
      return;
    }
    listener(getDemoAnalyticsConsent());
  };

  window.addEventListener(DEMO_ANALYTICS_CONSENT_CHANGE_EVENT, handleLocalChange);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(DEMO_ANALYTICS_CONSENT_CHANGE_EVENT, handleLocalChange);
    window.removeEventListener('storage', handleStorage);
  };
}
