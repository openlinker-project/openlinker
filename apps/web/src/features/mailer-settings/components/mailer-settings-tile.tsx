/**
 * Mailer Settings Tile
 *
 * Settings-index row for the outbound mail transport. The transport is the
 * value; for SMTP the quiet note names the server and sender, and says so when
 * the password is missing, since that is the one detail an operator must act on.
 *
 * @module apps/web/src/features/mailer-settings/components
 */
import { useState, type ReactElement } from 'react';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { useMessages } from '../../../shared/i18n';
import { SettingsIndexRow } from '../../../shared/ui/settings-index-row';
import { useMailerSettingsQuery } from '../hooks/use-mailer-settings-query';
import { MailerSettingsDialog } from './mailer-settings-dialog';

function MailerSettingsLive(): ReactElement {
  const copy = useMessages('mailer-settings').mailerSettingsTile;
  const query = useMailerSettingsQuery();
  const [dialogOpen, setDialogOpen] = useState(false);
  const view = query.data;

  const notice =
    !view
      ? undefined
      : view.transport === 'console'
        ? copy.consoleNote
        : view.smtpPasswordConfigured
          ? undefined
          : `${copy.passwordLabel}: ${copy.notSet}`;
  const suffix =
    view && view.transport === 'smtp'
      ? `${view.smtpHost ?? '-'}${view.smtpPort ? `:${String(view.smtpPort)}` : ''}`
      : undefined;

  return (
    <SettingsIndexRow
      icon="send"
      tone={!view ? undefined : view.transport === 'console' || !view.smtpPasswordConfigured ? 'warning' : 'success'}
      title={copy.title}
      description={copy.description}
      valueState={query.isLoading ? 'loading' : query.isError ? 'error' : 'ready'}
      stateText={
        query.isError
          ? `${copy.loadError} ${describeApiError(query.error, 'mailer-settings')}`
          : copy.loading
      }
      value={view ? copy.transport[view.transport] : undefined}
      caption={view ? copy.transportLabel : undefined}
      suffix={suffix}
      notice={notice}
      dot
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
        <MailerSettingsDialog
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

export function MailerSettingsTile({ locked = false }: { locked?: boolean }): ReactElement {
  const copy = useMessages('mailer-settings').mailerSettingsTile;
  return locked ? (
    <SettingsIndexRow locked icon="send" title={copy.title} description={copy.description} />
  ) : (
    <MailerSettingsLive />
  );
}
