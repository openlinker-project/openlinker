/**
 * Analytics Consent Tile Component
 *
 * Self-service UI for users to toggle analytics consent in demo mode.
 * Calls the backend endpoint, updates localStorage, and toggles PostHog.
 *
 * @module features/demo/components
 */
import type { ReactElement } from 'react';
import { useSession } from '../../../shared/auth/use-session';
import { useDemoMode } from '../../../features/system/hooks/use-demo-mode';
import { useToast } from '../../../shared/ui/toast-provider';
import { useUpdateAnalyticsConsentMutation } from '../../auth/hooks/use-update-analytics-consent-mutation';
import { disableDemoAnalytics, enableDemoAnalytics } from '../lib/init-demo-integrations';
import { setDemoAnalyticsConsent } from '../lib/demo-analytics-consent';
import type { DemoAnalyticsConsent } from '../demo.types';

export function AnalyticsConsentTile(): ReactElement | null {
  const { isReady, session } = useSession();
  const demoMode = useDemoMode();
  const mutation = useUpdateAnalyticsConsentMutation();
  const { showToast } = useToast();

  if (!demoMode || !isReady || session.status !== 'authenticated') {
    return null;
  }

  const consent = session.user?.analyticsConsent ?? false;

  const handleToggle = async (next: boolean): Promise<void> => {
    try {
      await mutation.mutateAsync({ analyticsConsent: next });
      const demoConsent: DemoAnalyticsConsent = next ? 'accepted' : 'declined';
      setDemoAnalyticsConsent(demoConsent);
      if (next) {
        enableDemoAnalytics();
      } else {
        disableDemoAnalytics();
      }
      showToast({
        tone: 'success',
        title: 'Saved',
        description: next ? 'Analytics sharing enabled.' : 'Analytics sharing disabled.',
      });
    } catch {
      showToast({ tone: 'error', description: 'Could not update your analytics preference.' });
    }
  };

  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Privacy</p>
          <h3 className="section-title">Analytics</h3>
        </div>
      </div>

      <label className="guest-form__consent">
        <input
          type="checkbox"
          checked={consent}
          disabled={mutation.isPending}
          onChange={(event) => void handleToggle(event.target.checked)}
        />
        <span className="guest-form__consent-text">
          <strong>Share anonymous usage analytics</strong>
          <span className="guest-form__consent-hint">
            Includes session recording with all inputs masked. Change this anytime.
          </span>
        </span>
      </label>
    </article>
  );
}
