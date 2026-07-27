/**
 * Analytics Consent Tile Component
 *
 * Self-service UI for users to toggle analytics consent in demo mode.
 * Calls the backend endpoint (authoritative, cross-device), mirrors the result
 * into localStorage (what the pre-auth boot path reads), and opts PostHog
 * in/out live so the change takes effect without a reload.
 *
 * @module features/demo/components
 */
import type { ReactElement } from 'react';
import { useSession } from '../../../shared/auth/use-session';
import { useDemoMode } from '../../system/hooks/use-demo-mode';
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
        <span className="panel__meta">Demo only</span>
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
          {/* Copy must track the real masking config in
              init-demo-integrations.ts — #1878 narrowed masking to passwords
              only, so "all inputs masked" is no longer true (#1882). */}
          <span className="guest-form__consent-hint">
            Includes session recording. Passwords are never recorded; other text you type and view
            may be. Change this anytime.
          </span>
        </span>
      </label>
    </article>
  );
}
