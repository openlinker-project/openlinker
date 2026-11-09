import { useState, type ReactElement } from 'react';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { Link } from 'react-router-dom';
import type { Connection } from '../api/connections.types';
import { canArchive, hasMissingCredentials } from '../api/connections.types';
import { useDisableConnectionMutation } from '../hooks/use-disable-connection-mutation';
import { useTestConnectionMutation } from '../hooks/use-test-connection-mutation';
import { EnableConnectionButton } from './EnableConnectionButton';
import { ArchiveConnectionButton } from './archive-connection-button';
import { RestoreConnectionButton } from './restore-connection-button';
import { usePlatform } from '../../../shared/plugins';
import { TriggerSyncDialog } from '../../sync-jobs';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { Alert } from '../../../shared/ui/alert';
import { useToast } from '../../../shared/ui/toast-provider';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import { captureDemoEvent } from '../../demo';
import { describeApiError } from '../../../shared/api/describe-api-error';

interface ConnectionActionsPanelProps {
  connection: Connection;
  /** Replaces "Edit connection" for a connection configured elsewhere (the OMS). */
  settingsLink?: { to: string; label: string };
}

export function ConnectionActionsPanel({ connection, settingsLink }: ConnectionActionsPanelProps): ReactElement {
  const copy = useMessages('connections').connectionActionsPanel;
  const uiCopy = useMessages('ui');
  const format = useFormat();
  const disableConnection = useDisableConnectionMutation();
  const testConnection = useTestConnectionMutation();
  const { showToast } = useToast();
  const [isDisableDialogOpen, setIsDisableDialogOpen] = useState(false);
  const [isTriggerDialogOpen, setIsTriggerDialogOpen] = useState(false);
  const plugin = usePlatform(connection.platformType);
  const PluginActions = plugin?.ConnectionActions;

  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const sync = useWriteAccess('sync:write', demoMode);

  const isDisabled = connection.status === 'disabled';
  // #3657 — an archived connection has no credential and resolves no adapter,
  // so Test / Trigger sync / Disable / Enable would all fail. Restore is the
  // only action that means anything there.
  const isArchived = connection.status === 'archived';

  async function handleTest(): Promise<void> {
    try {
      const result = await testConnection.mutateAsync(connection.id);
      const details = `${uiCopy.apiError.technicalDetails}: ${result.message}`;
      showToast({
        tone: result.success ? 'success' : 'error',
        title: result.success
          ? interpolate(copy.test.ok, { ms: format.number(result.latencyMs) })
          : copy.test.failed,
        description:
          result.success || result.status === undefined
            ? details
            : interpolate(copy.test.failedWithStatus, {
                message: details,
                status: result.status,
              }),
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: copy.test.failed,
        description: describeApiError(error, 'connections'),
      });
    }
  }

  if (isArchived) {
    return (
      <div className="panel panel--dense">
        <div className="panel__header">
          <div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h3 className="section-title">{copy.title}</h3>
          </div>
          <span className="panel__meta">{copy.meta}</span>
        </div>
        <div className="action-list">
          {write.visible ? (
            <div className="action-list__item">
              <div>
                <strong>{copy.restore.title}</strong>
                <p className="muted-text">
                  {copy.restore.help}
                </p>
              </div>
              <RestoreConnectionButton connection={connection} />
            </div>
          ) : (
            <p className="muted-text">{copy.archived}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title">{copy.title}</h3>
        </div>
        <span className="panel__meta">{copy.meta}</span>
      </div>

      {disableConnection.error ? (
        <Alert tone="error" title={copy.disable.errorTitle}>
          {describeApiError(disableConnection.error, 'connections')}
        </Alert>
      ) : null}

      <div className="action-list">
        {write.visible ? (
          <div className="action-list__item">
            <div>
              <strong>{copy.test.title}</strong>
              <p className="muted-text">
                {copy.test.help}
              </p>
            </div>
            <ReadOnlyLock
              active={write.demoReadOnly}
              message={demoReadOnlyActionMessage()}
              onLockedClick={() =>
                captureDemoEvent('demo_connection_test_attempted', { platform: connection.platformType })
              }
            >
              <Button
                tone="secondary"
                disabled={testConnection.isPending || write.demoReadOnly}
                onClick={() => void handleTest()}
              >
                {testConnection.isPending ? copy.test.testing : copy.test.title}
              </Button>
            </ReadOnlyLock>
          </div>
        ) : null}

        {write.visible && settingsLink ? (
          <div className="action-list__item">
            <div>
              <strong>{settingsLink.label}</strong>
              <p className="muted-text">{copy.settings.help}</p>
            </div>
            <Link className="button button--secondary" to={settingsLink.to}>
              {copy.settings.open}
            </Link>
          </div>
        ) : null}

        {write.visible && !settingsLink ? (
          <div className="action-list__item">
            <div>
              <strong>{copy.edit.title}</strong>
              <p className="muted-text">{copy.edit.help}</p>
            </div>
            <Link className="button button--secondary" to={`/connections/${connection.id}/edit`}>
              {copy.edit.action}
            </Link>
          </div>
        ) : null}

        {write.visible && PluginActions ? (
          <PluginActions connection={connection} readOnly={write.demoReadOnly} />
        ) : null}

        {sync.visible && !isDisabled ? (
          <div className="action-list__item">
            <div>
              <strong>{copy.sync.title}</strong>
              <p className="muted-text">
                {copy.sync.help}
              </p>
            </div>
            <Button
              tone="primary"
              onClick={() => {
                captureDemoEvent('demo_connection_sync_dialog_opened', {});
                setIsTriggerDialogOpen(true);
              }}
            >
              {copy.sync.action}
            </Button>
          </div>
        ) : null}

        {write.visible && !isDisabled ? (
          <div className="action-list__item">
            <div>
              <strong>{copy.disable.title}</strong>
              <p className="muted-text">{copy.disable.help}</p>
            </div>
            <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
              <Button
                tone="danger"
                onClick={() => setIsDisableDialogOpen(true)}
                disabled={disableConnection.isPending || write.demoReadOnly}
              >
                {disableConnection.isPending ? copy.disable.disabling : copy.disable.action}
              </Button>
            </ReadOnlyLock>
          </div>
        ) : null}

        {write.visible && isDisabled && !hasMissingCredentials(connection) ? (
          <div className="action-list__item">
            <div>
              <strong>{copy.enable.title}</strong>
              <p className="muted-text">
                {copy.enable.help}
              </p>
            </div>
            <EnableConnectionButton connection={connection} />
          </div>
        ) : null}

        {write.visible && isDisabled && !canArchive(connection) ? (
          <div className="action-list__item">
            <div>
              <strong>{copy.archive.title}</strong>
              <p className="muted-text">{copy.archive.notArchivable}</p>
            </div>
          </div>
        ) : null}

        {write.visible && canArchive(connection) ? (
          <div className="action-list__item">
            <div>
              <strong>{copy.archive.title}</strong>
              <p className="muted-text">{copy.archive.help}</p>
            </div>
            <ArchiveConnectionButton connection={connection} />
          </div>
        ) : null}
      </div>

      <TriggerSyncDialog
        connection={connection}
        open={isTriggerDialogOpen}
        onOpenChange={setIsTriggerDialogOpen}
        submitDisabled={sync.demoReadOnly}
      />

      <ConfirmDialog
        open={isDisableDialogOpen}
        onOpenChange={setIsDisableDialogOpen}
        title={copy.disable.dialogTitle}
        description={interpolate(copy.disable.dialogDescription, { name: connection.name })}
        confirmLabel={copy.disable.title}
        cancelLabel={copy.disable.cancel}
        tone="danger"
        onConfirm={async () => {
          try {
            await disableConnection.mutateAsync(connection.id);
            setIsDisableDialogOpen(false);
            showToast({
              tone: 'success',
              title: copy.disable.doneTitle,
              description: interpolate(copy.disable.doneDescription, { name: connection.name }),
            });
          } catch {
            setIsDisableDialogOpen(false);
          }
        }}
      />
    </div>
  );
}
