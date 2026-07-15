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
import { Button } from '../../../shared/ui/button';
import { useMailerSettingsQuery } from '../hooks/use-mailer-settings-query';
import { MailerSettingsDialog } from './mailer-settings-dialog';

const TRANSPORT_LABEL: Record<'console' | 'smtp', string> = {
  console: 'Console',
  smtp: 'SMTP',
};

export function MailerSettingsTile(): ReactElement {
  const query = useMailerSettingsQuery();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Outbound mail</p>
          <h3 className="section-title">Mailer</h3>
        </div>
        <span className="panel__meta">Admin only</span>
      </div>

      {query.isLoading ? (
        <p className="muted-text" aria-live="polite">
          Loading mailer settings…
        </p>
      ) : null}

      {query.isError ? (
        <p className="muted-text" role="alert">
          Could not load mailer settings: {query.error.message}
        </p>
      ) : null}

      {query.data ? (
        <>
          <dl className="definition-list">
            <div>
              <dt>Transport</dt>
              <dd>{TRANSPORT_LABEL[query.data.transport]}</dd>
            </div>
            {query.data.transport === 'smtp' ? (
              <>
                <div>
                  <dt>Host</dt>
                  <dd className="mono-text">{query.data.smtpHost ?? '—'}</dd>
                </div>
                <div>
                  <dt>Port</dt>
                  <dd className="mono-text">{query.data.smtpPort ?? '—'}</dd>
                </div>
                <div>
                  <dt>From address</dt>
                  <dd className="mono-text">{query.data.fromAddress ?? '—'}</dd>
                </div>
                <div>
                  <dt>SMTP password</dt>
                  <dd>{query.data.smtpPasswordConfigured ? 'Configured' : 'Not set'}</dd>
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
            Edit
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
