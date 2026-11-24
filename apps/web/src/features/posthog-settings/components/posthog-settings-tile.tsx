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
import { describeApiError } from '../../../shared/api/describe-api-error';
import { useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { usePosthogSettingsQuery } from '../hooks/use-posthog-settings-query';
import { PosthogSettingsDialog } from './posthog-settings-dialog';

export function PosthogSettingsTile(): ReactElement {
  const copy = useMessages('posthog-settings').posthogSettingsTile;
  const query = usePosthogSettingsQuery();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title">{copy.title}</h3>
        </div>
        <span className="panel__meta">{copy.adminOnly}</span>
      </div>

      {query.isLoading ? (
        <p className="muted-text" aria-live="polite">
          {copy.loading}
        </p>
      ) : null}

      {query.isError ? (
        <p className="muted-text" role="alert">
          {copy.loadError} {describeApiError(query.error, 'posthog-settings')}
        </p>
      ) : null}

      {query.data ? (
        <>
          <div className="toolbar__group posthog-settings-tile__badges">
            <span className={`context-chip context-chip--${query.data.enabled ? 'success' : 'neutral'}`}>
              {query.data.enabled ? copy.enabled : copy.disabled}
            </span>
            {query.data.wouldOverrideEnv ? (
              <span className="context-chip context-chip--warning">{copy.overridesEnv}</span>
            ) : null}
          </div>

          {query.data.enabled ? (
            <dl className="definition-list">
              <div>
                <dt>{copy.sourceLabel}</dt>
                <dd>{query.data.wouldOverrideEnv ? copy.sourceSaved : copy.sourceEnvironment}</dd>
              </div>
              <div>
                <dt>{copy.apiKeyLabel}</dt>
                <dd>{query.data.apiKeyConfigured ? copy.configured : copy.notSet}</dd>
              </div>
              <div>
                <dt>{copy.regionLabel}</dt>
                <dd>{copy.region[query.data.region]}</dd>
              </div>
              <div>
                <dt>{copy.autocaptureLabel}</dt>
                <dd>{query.data.autocapture ? copy.on : copy.off}</dd>
              </div>
              <div>
                <dt>{copy.sessionRecordingLabel}</dt>
                <dd>{query.data.sessionRecording ? copy.on : copy.off}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted-text panel-copy">{copy.disabledMessage}</p>
          )}

          <Button
            tone="secondary"
            className="button--sm"
            onClick={() => {
              setDialogOpen(true);
            }}
          >
            {copy.edit}
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
