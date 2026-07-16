/**
 * Init Demo Integrations
 *
 * Gated loader for demo-only third-party integrations (today: PostHog
 * session recording). `posthog-js` is dynamically imported so it is never
 * fetched on a normal (non-demo) install — the three synchronous guards
 * (demo mode, config presence, visitor consent) all run before the import.
 *
 * `autocapture` and whether session recording is enabled at all (#1685) are
 * now read from the resolved config rather than hardcoded — an admin
 * toggles them via the PostHog settings dialog on `/settings`. Masking
 * WITHIN session recording stays unconditional regardless of that toggle
 * (`maskTextSelector: '*'` masks every rendered text node), not opt-in by
 * selector: demo mode must only ever run against synthetic seed data (see
 * docs/one-command-demo-setup-guide.md), but rrweb records every rendered
 * DOM text node by default, so an operator who points a demo instance at
 * real data would otherwise ship buyer PII to PostHog cloud.
 */
import type { PostHog } from 'posthog-js';
import type { SystemConfig } from '../../system';
import { getDemoAnalyticsConsent } from './demo-analytics-consent';

let posthogInstance: PostHog | null = null;

export async function initDemoIntegrations(config: SystemConfig | undefined): Promise<void> {
  const posthogConfig = config?.demoMode ? config.demoIntegrations?.posthog : undefined;
  if (!posthogConfig?.key) {
    return;
  }

  if (getDemoAnalyticsConsent() !== 'accepted') {
    return;
  }

  const { default: posthog } = await import('posthog-js');
  posthogInstance = posthog;
  posthog.init(posthogConfig.key, {
    api_host: posthogConfig.host,
    person_profiles: 'identified_only',
    autocapture: posthogConfig.autocapture,
    capture_pageview: true,
    session_recording: posthogConfig.sessionRecording
      ? {
          maskAllInputs: true,
          maskTextSelector: '*',
        }
      : undefined,
  });
}

/**
 * Opts the current visitor out of PostHog capture without a page reload, so
 * the in-banner "disable" affordance takes effect immediately. A no-op when
 * PostHog was never initialized (consent was never accepted this session).
 */
export function disableDemoAnalytics(): void {
  posthogInstance?.opt_out_capturing();
}
