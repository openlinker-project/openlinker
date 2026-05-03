import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { Connection } from '../api/connections.types';
import { useDisableConnectionMutation } from '../hooks/use-disable-connection-mutation';
import { useTestConnectionMutation } from '../hooks/use-test-connection-mutation';
import { useConfigureWebhooksMutation } from '../hooks/use-configure-webhooks-mutation';
import { TriggerSyncDialog } from '../../sync-jobs/components/TriggerSyncDialog';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { Alert } from '../../../shared/ui/alert';
import { useToast } from '../../../shared/ui/toast-provider';

interface ConnectionActionsPanelProps {
  connection: Connection;
}

export function ConnectionActionsPanel({ connection }: ConnectionActionsPanelProps): ReactElement {
  const disableConnection = useDisableConnectionMutation();
  const testConnection = useTestConnectionMutation();
  const configureWebhooks = useConfigureWebhooksMutation();
  const { showToast } = useToast();
  const [isDisableDialogOpen, setIsDisableDialogOpen] = useState(false);
  const [isTriggerDialogOpen, setIsTriggerDialogOpen] = useState(false);

  const isDisabled = connection.status === 'disabled';
  const isPrestashop = connection.platformType === 'prestashop';
  const webhooksConfigured =
    typeof connection.config === 'object' &&
    connection.config !== null &&
    (connection.config as Record<string, unknown>).webhooksConfigured === true;

  async function handleConfigureWebhooks(): Promise<void> {
    try {
      const result = await configureWebhooks.mutateAsync(connection.id);
      if (result.webhooksConfigured && result.testPingTriggered) {
        showToast({
          tone: 'success',
          title: 'Webhooks configured',
          description:
            "PrestaShop module updated and verified by a test ping. You're done.",
        });
      } else if (result.webhooksConfigured) {
        // Push succeeded but ping didn't make it back. Configuration is correct;
        // verification is incomplete. Operator can retry or wait for a real event.
        showToast({
          tone: 'warning',
          title: 'Webhooks configured (ping not received)',
          description:
            'Configuration is in place but the test ping did not arrive. Click again to retry, or wait for the next real event.',
        });
      } else {
        showToast({
          tone: 'error',
          title: 'Configuration push failed',
          description: result.warning ?? 'PrestaShop did not accept the configuration push.',
        });
      }
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Configuration push failed',
        description: (error as Error).message,
      });
    }
  }

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
        <div className="action-list__item">
          <div>
            <strong>Test connection</strong>
            <p className="muted-text">
              Probe the integration using a cheap authenticated call. Verifies the base URL and
              stored credentials.
            </p>
          </div>
          <Button
            tone="secondary"
            disabled={testConnection.isPending}
            onClick={() => void handleTest()}
          >
            {testConnection.isPending ? 'Testing...' : 'Test connection'}
          </Button>
        </div>

        <div className="action-list__item">
          <div>
            <strong>Edit connection</strong>
            <p className="muted-text">Update name, config, or adapter settings.</p>
          </div>
          <Link className="button button--secondary" to={`/connections/${connection.id}/edit`}>
            Edit
          </Link>
        </div>

        {isPrestashop ? (
          <div className="action-list__item">
            <div>
              <strong>Configure webhooks</strong>
              <p className="muted-text">
                Push Base URL, Connection ID, and a freshly-rotated Webhook Secret to the
                PrestaShop module via WS. Verifies with a synchronous test ping.
                {webhooksConfigured ? ' Currently configured ✓' : ''}
              </p>
            </div>
            <Button
              tone={webhooksConfigured ? 'secondary' : 'primary'}
              disabled={configureWebhooks.isPending}
              onClick={() => void handleConfigureWebhooks()}
            >
              {configureWebhooks.isPending
                ? 'Configuring...'
                : webhooksConfigured
                  ? 'Re-configure webhooks'
                  : 'Configure webhooks'}
            </Button>
          </div>
        ) : null}

        {!isDisabled ? (
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

        {isDisabled ? null : (
          <div className="action-list__item">
            <div>
              <strong>Disable connection</strong>
              <p className="muted-text">Stop all sync activity for this connection. This can be reversed by re-enabling.</p>
            </div>
            <Button
              tone="danger"
              onClick={() => setIsDisableDialogOpen(true)}
              disabled={disableConnection.isPending}
            >
              {disableConnection.isPending ? 'Disabling...' : 'Disable'}
            </Button>
          </div>
        )}
      </div>

      <TriggerSyncDialog
        connection={connection}
        open={isTriggerDialogOpen}
        onOpenChange={setIsTriggerDialogOpen}
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
