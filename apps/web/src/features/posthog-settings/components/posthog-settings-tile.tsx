/**
 * PostHog Settings Tile
 *
 * Settings-index row for product analytics. The value is whether it is on; the
 * quiet note says where the setting comes from (saved here, or the server
 * environment) and what is captured, so the row answers "is this recording?"
 * without opening the dialog.
 *
 * @module apps/web/src/features/posthog-settings/components
 */
import { useState, type ReactElement } from 'react';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { useMessages } from '../../../shared/i18n';
import { SettingsIndexRow } from '../../../shared/ui/settings-index-row';
import { usePosthogSettingsQuery } from '../hooks/use-posthog-settings-query';
import { PosthogSettingsDialog } from './posthog-settings-dialog';

function PosthogSettingsLive(): ReactElement {
  const copy = useMessages('posthog-settings').posthogSettingsTile;
  const query = usePosthogSettingsQuery();
  const [dialogOpen, setDialogOpen] = useState(false);
  const view = query.data;

  const note = !view || !view.enabled ? undefined : (
    <>
      <span className="settings-row__line">
        {view.wouldOverrideEnv ? copy.overridesEnv : copy.sourceEnvironment}
      </span>
      <span className="settings-row__line">{copy.region[view.region]}</span>
      <span className="settings-row__line">
        {copy.sessionRecordingLabel}: {view.sessionRecording ? copy.on : copy.off}
      </span>
      {view.apiKeyConfigured ? null : (
        <span className="settings-row__line">
          {copy.apiKeyLabel}: {copy.notSet}
        </span>
      )}
    </>
  );

  return (
    <SettingsIndexRow
      title={copy.title}
      description={copy.description}
      valueState={query.isLoading ? 'loading' : query.isError ? 'error' : 'ready'}
      stateText={
        query.isError
          ? `${copy.loadError} ${describeApiError(query.error, 'posthog-settings')}`
          : copy.loading
      }
      value={view ? (view.enabled ? copy.enabled : copy.disabled) : undefined}
      note={note}
      action={
        view
          ? {
              label: copy.edit,
              onClick: (): void => {
                setDialogOpen(true);
              },
            }
          : undefined
      }
    >
      {view ? (
        <PosthogSettingsDialog
          open={dialogOpen}
          view={view}
          onClose={() => {
            setDialogOpen(false);
          }}
        />
      ) : null}
    </SettingsIndexRow>
  );
}

export function PosthogSettingsTile({ locked = false }: { locked?: boolean }): ReactElement {
  const copy = useMessages('posthog-settings').posthogSettingsTile;
  return locked ? (
    <SettingsIndexRow locked title={copy.title} description={copy.description} />
  ) : (
    <PosthogSettingsLive />
  );
}
