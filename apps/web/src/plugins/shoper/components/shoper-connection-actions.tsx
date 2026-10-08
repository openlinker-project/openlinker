/**
 * Shoper Connection Actions
 *
 * Plugin-owned action row for Shoper connections: "Configure webhooks"
 * (#3644). Registers one webhook with the shop that calls back into
 * OpenLinker. Shoper has no test ping, so success means the shop accepted
 * the registration.
 *
 * @module plugins/shoper/components
 */
import type { ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useToast } from '../../../shared/ui/toast-provider';
import { useConfigureWebhooksMutation } from '../../../features/connections';
import type { Connection } from '../../../features/connections';

interface ShoperConnectionActionsProps {
  connection: Connection;
  readOnly?: boolean;
}

export function ShoperConnectionActions({
  connection,
  readOnly = false,
}: ShoperConnectionActionsProps): ReactElement {
  const configureWebhooks = useConfigureWebhooksMutation();
  const { showToast } = useToast();

  const webhooksConfigured =
    typeof connection.config === 'object' &&
    connection.config !== null &&
    (connection.config as Record<string, unknown>).webhooksConfigured === true;
  const orderSourceEnabled = connection.enabledCapabilities.includes('OrderSource');

  async function handleConfigureWebhooks(): Promise<void> {
    try {
      const result = await configureWebhooks.mutateAsync(connection.id);
      if (result.webhooksConfigured) {
        showToast({
          tone: 'success',
          title: 'Webhooks configured',
          description: 'Shoper will now notify OpenLinker when an order is created or changes.',
        });
      } else {
        showToast({
          tone: 'error',
          title: 'Webhook registration failed',
          description: result.warning ?? 'Shoper did not accept the webhook registration.',
        });
      }
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Webhook registration failed',
        description: (error as Error).message,
      });
    }
  }

  return (
    <div className="action-list__item">
      <div>
        <strong>Configure webhooks</strong>
        <p className="muted-text">
          Registers a webhook in Shoper so new and changed orders reach OpenLinker right away.
          Needs the OL callback URL and the Order source capability.
          {webhooksConfigured ? ' Currently configured ✓' : ''}
        </p>
      </div>
      <ReadOnlyLock active={readOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
        <Button
          tone={webhooksConfigured ? 'secondary' : 'primary'}
          disabled={configureWebhooks.isPending || readOnly || !orderSourceEnabled}
          onClick={() => void handleConfigureWebhooks()}
        >
          {configureWebhooks.isPending
            ? 'Configuring...'
            : webhooksConfigured
              ? 'Re-configure webhooks'
              : 'Configure webhooks'}
        </Button>
      </ReadOnlyLock>
    </div>
  );
}
