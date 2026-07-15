import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { Connection } from '../api/connections.types';
import { useDisableConnectionMutation } from '../hooks/use-disable-connection-mutation';
import { useTestConnectionMutation } from '../hooks/use-test-connection-mutation';
import { usePlatform } from '../../../shared/plugins';
import { TriggerSyncDialog } from '../../sync-jobs';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { Alert } from '../../../shared/ui/alert';
import { useToast } from '../../../shared/ui/toast-provider';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';

interface ConnectionActionsPanelProps {
  connection: Connection;
}

export function ConnectionActionsPanel({ connection }: ConnectionActionsPanelProps): ReactElement {
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

  async function handleTest(): Promise<void> {
    try {
      const result = await testConnection.mutateAsync(connection.id);
      showToast({
        tone: result.success ? 'success' : 'error',
        title: result.success
          ? `Connection OK (${result.latencyMs}ms)`
          : 'Connection test failed',
        description: result.success
          ? result.message
          : `${result.message}${
              result.status !== undefined ? ` (HTTP ${result.status})` : ''
            }`,
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Connection test failed',
        description: (error as Error).message,
      });
    }
  }

  return (
    <div className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Operator</p>
          <h3 className="section-title">Actions</h3>
        </div>
        <span className="panel__meta">Manage connection</span>
      </div>

      {disableConnection.error ? (
        <Alert tone="error" title="Unable to disable connection">
          {disableConnection.error.message}
        </Alert>
      ) : null}

      <div className="action-list">
        {write.visible ? (
          <div className="action-list__item">
            <div>
              <strong>Test connection</strong>
              <p className="muted-text">
                Probe the integration using a cheap authenticated call. Verifies the base URL and
                stored credentials.
              </p>
            </div>
            <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
              <Button
                tone="secondary"
                disabled={testConnection.isPending || write.demoReadOnly}
                onClick={() => void handleTest()}
              >
                {testConnection.isPending ? 'Testing...' : 'Test connection'}
              </Button>
            </ReadOnlyLock>
          </div>
        ) : null}

        {write.visible ? (
          <div className="action-list__item">
            <div>
              <strong>Edit connection</strong>
              <p className="muted-text">Update name, config, or adapter settings.</p>
            </div>
            <Link className="button button--secondary" to={`/connections/${connection.id}/edit`}>
              Edit
            </Link>
          </div>
        ) : null}

        {write.visible && PluginActions ? (
          <PluginActions connection={connection} readOnly={write.demoReadOnly} />
        ) : null}

        {sync.visible && !isDisabled ? (
          <div className="action-list__item">
            <div>
              <strong>Trigger sync</strong>
              <p className="muted-text">
                Manually enqueue a sync job for this connection. Choose job type and payload in the
                next step.
              </p>
            </div>
            <Button
              tone="primary"
              onClick={() => setIsTriggerDialogOpen(true)}
            >
              Trigger sync…
            </Button>
          </div>
        ) : null}

        {write.visible && !isDisabled ? (
          <div className="action-list__item">
            <div>
              <strong>Disable connection</strong>
              <p className="muted-text">Stop all sync activity for this connection. This can be reversed by re-enabling.</p>
            </div>
            <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
              <Button
                tone="danger"
                onClick={() => setIsDisableDialogOpen(true)}
                disabled={disableConnection.isPending || write.demoReadOnly}
              >
                {disableConnection.isPending ? 'Disabling...' : 'Disable'}
              </Button>
            </ReadOnlyLock>
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
        title="Disable this connection?"
        description={`This will stop all sync activity for "${connection.name}". You can re-enable it later.`}
        confirmLabel="Disable connection"
        cancelLabel="Keep active"
        tone="danger"
        onConfirm={async () => {
          try {
            await disableConnection.mutateAsync(connection.id);
            setIsDisableDialogOpen(false);
            showToast({
              tone: 'success',
              title: 'Connection disabled',
              description: `"${connection.name}" has been disabled.`,
            });
          } catch {
            setIsDisableDialogOpen(false);
          }
        }}
      />
    </div>
  );
}
