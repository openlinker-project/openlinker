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
 * toggles them via the PostHog settings dialog on `/settings`.
 *
 * Masking within session recording is narrowed to PASSWORDS ONLY (#1877).
 * Page text and ordinary input values (search boxes, filters, form fields)
 * are recorded verbatim — a replay that masks everything shows the layout
 * and none of the content, which defeats the point of recording a demo.
 *
 * CONSEQUENCE — READ BEFORE WIDENING THE DEMO DATASET: the previous
 * blanket mask (`maskTextSelector: '*'`) doubled as a backstop against an
 * operator pointing a demo instance at a live store. That backstop is gone.
 * The requirement that demo mode runs ONLY against synthetic seed data (see
 * docs/one-command-demo-setup-guide.md) is now load-bearing, not belt-and-
 * braces: with real data behind it, rrweb would ship buyer names, addresses,
 * and tax IDs (KSeF / invoicing surfaces) to PostHog cloud verbatim.
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
          // Passwords only (#1877). `password` is stated explicitly rather
          // than left to rrweb's implicit default so the one guarantee this
          // config still makes is visible in the source.
          maskAllInputs: false,
          maskInputOptions: { password: true },
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

/**
 * Opts the current visitor back in to PostHog capture without a page reload.
 * A no-op when PostHog was never initialized.
 */
export function enableDemoAnalytics(): void {
  posthogInstance?.opt_in_capturing();
}
