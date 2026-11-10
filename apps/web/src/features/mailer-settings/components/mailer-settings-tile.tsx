/**
 * Mailer Settings Tile
 *
 * Read-only summary of the current mailer/SMTP transport, rendered on
 * `/settings` next to the Environment and Account tiles. Admin-only — the
 * caller (`settings-page.tsx`) mounts this component only for an
 * authenticated admin session, so a non-admin never even triggers the
 * `GET /mailer-settings` request.
 *
 * @module apps/web/src/features/mailer-settings/components
 */
import { useState, type ReactElement } from 'react';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { useMailerSettingsQuery } from '../hooks/use-mailer-settings-query';
import { MailerSettingsDialog } from './mailer-settings-dialog';

export function MailerSettingsTile(): ReactElement {
  const copy = useMessages('mailer-settings').mailerSettingsTile;
  const query = useMailerSettingsQuery();
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
          {copy.loadError} {describeApiError(query.error, 'mailer-settings')}
        </p>
      ) : null}

      {query.data ? (
        <>
          <dl className="definition-list">
            <div>
              <dt>{copy.transportLabel}</dt>
              <dd>{copy.transport[query.data.transport]}</dd>
            </div>
            {query.data.transport === 'smtp' ? (
              <>
                <div>
                  <dt>{copy.hostLabel}</dt>
                  <dd className="mono-text">{query.data.smtpHost ?? '—'}</dd>
                </div>
                <div>
                  <dt>{copy.portLabel}</dt>
                  <dd className="mono-text">{query.data.smtpPort ?? '—'}</dd>
                </div>
                <div>
                  <dt>{copy.fromLabel}</dt>
                  <dd className="mono-text">{query.data.fromAddress ?? '—'}</dd>
                </div>
                <div>
                  <dt>{copy.passwordLabel}</dt>
                  <dd>{query.data.smtpPasswordConfigured ? copy.configured : copy.notSet}</dd>
                </div>
              </>
            ) : null}
          </dl>

          <Button
            tone="secondary"
            className="button--sm"
            onClick={() => {
              setDialogOpen(true);
            }}
          >
            {copy.edit}
          </Button>

          <MailerSettingsDialog
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
