/**
 * Init Demo Integrations
 *
 * Gated loader for demo-only third-party integrations (today: PostHog
 * session recording). `posthog-js` is dynamically imported so it is never
 * fetched on a normal (non-demo) install — the three synchronous guards
 * (demo mode, config presence, visitor consent) all run before the import.
 */
import type { SystemConfig } from '../../system';
import { getDemoAnalyticsConsent } from './demo-analytics-consent';

export async function initDemoIntegrations(config: SystemConfig | undefined): Promise<void> {
  const posthogConfig = config?.demoMode ? config.demoIntegrations?.posthog : undefined;
  if (!posthogConfig?.key) {
    return;
  }

  if (getDemoAnalyticsConsent() !== 'accepted') {
    return;
  }

  const { default: posthog } = await import('posthog-js');
  posthog.init(posthogConfig.key, {
    api_host: posthogConfig.host,
    person_profiles: 'identified_only',
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '[data-ph-mask]',
    },
  });
}
