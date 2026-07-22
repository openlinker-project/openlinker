/**
 * PostHog Settings Tile
 *
 * Read-only summary of the current PostHog analytics configuration,
 * rendered on `/settings` next to the Environment, Account, and Mailer
 * tiles. Admin-only — the caller (`settings-page.tsx`) mounts this
 * component only for an authenticated admin session, so a non-admin never
 * even triggers the `GET /posthog-settings` request.
 *
 * @module apps/web/src/features/posthog-settings/components
 */
import { useState, type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { usePosthogSettingsQuery } from '../hooks/use-posthog-settings-query';
import { PosthogSettingsDialog } from './posthog-settings-dialog';

const REGION_LABEL: Record<'eu' | 'us' | 'custom', string> = {
  eu: 'EU Cloud',
  us: 'US Cloud',
  custom: 'Custom host',
};

export function PosthogSettingsTile(): ReactElement {
  const query = usePosthogSettingsQuery();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Product analytics</p>
          <h3 className="section-title">PostHog</h3>
        </div>
        <span className="panel__meta">Admin only</span>
      </div>

      {query.isLoading ? (
        <p className="muted-text" aria-live="polite">
          Loading analytics settings…
        </p>
      ) : null}

      {query.isError ? (
        <p className="muted-text" role="alert">
          Could not load analytics settings: {query.error.message}
        </p>
      ) : null}

      {query.data ? (
        <>
          <div className="toolbar__group posthog-settings-tile__badges">
            <span className={`context-chip context-chip--${query.data.enabled ? 'success' : 'neutral'}`}>
              {query.data.enabled ? 'Enabled' : 'Disabled'}
            </span>
            {query.data.wouldOverrideEnv ? (
              <span className="context-chip context-chip--warning">Overrides env</span>
            ) : null}
          </div>

          {query.data.enabled ? (
            <dl className="definition-list">
              <div>
                <dt>Source</dt>
                <dd>{query.data.wouldOverrideEnv ? 'Saved settings' : 'Environment'}</dd>
              </div>
              <div>
                <dt>API key</dt>
                <dd>{query.data.apiKeyConfigured ? 'Configured' : 'Not set'}</dd>
              </div>
              <div>
                <dt>Region</dt>
                <dd>{REGION_LABEL[query.data.region]}</dd>
              </div>
              <div>
                <dt>Autocapture</dt>
                <dd>{query.data.autocapture ? 'On' : 'Off'}</dd>
              </div>
              <div>
                <dt>Session recording</dt>
                <dd>{query.data.sessionRecording ? 'On' : 'Off'}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted-text panel-copy">
              Session recording and pageview capture are off. No PostHog script is loaded for demo
              visitors.
            </p>
          )}

          <Button
            tone="secondary"
            className="button--sm"
            onClick={() => {
              setDialogOpen(true);
            }}
          >
            Edit
          </Button>

          <PosthogSettingsDialog
            open={dialogOpen}
            view={query.data}
            onClose={() => {
              setDialogOpen(false);
            }}
          />
        </>
      ) : null}
    </article>
  );
}
