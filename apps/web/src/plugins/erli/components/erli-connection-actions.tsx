/**
 * Erli Connection Actions
 *
 * Plugin-owned action rows rendered inside `ConnectionActionsPanel` for
 * Erli connections. Exposes the "Configure webhooks" action (#1216) — guards
 * against a missing `config.callbackBaseUrl` (required by the backend before
 * it can register Erli webhook subscriptions) with an instructional message
 * instead of surfacing a raw 400.
 *
 * @module plugins/erli/components
 */
import type { ReactElement } from 'react';
import type { Connection } from '../../../features/connections';
import { useConfigureWebhooksMutation } from '../../../features/connections';
import { Button } from '../../../shared/ui/button';
import { useToast } from '../../../shared/ui/toast-provider';

interface ErliConnectionActionsProps {
  connection: Connection;
}

export function ErliConnectionActions({
  connection,
}: ErliConnectionActionsProps): ReactElement {
  const configureWebhooks = useConfigureWebhooksMutation();
  const { showToast } = useToast();

  const config =
    typeof connection.config === 'object' && connection.config !== null
      ? (connection.config as Record<string, unknown>)
      : {};

  const hasCallbackBaseUrl =
    typeof config.callbackBaseUrl === 'string' && config.callbackBaseUrl.length > 0;

  const webhooksConfigured = config.webhooksConfigured === true;

  async function handleConfigureWebhooks(): Promise<void> {
    try {
      const result = await configureWebhooks.mutateAsync(connection.id);
      if (result.webhooksConfigured && result.testPingTriggered) {
        showToast({
          tone: 'success',
          title: 'Webhooks configured',
          description: 'Erli webhook subscriptions registered and verified by a test ping.',
        });
      } else if (result.webhooksConfigured) {
        showToast({
          tone: 'warning',
          title: 'Webhooks configured (ping not received)',
          description:
            'Subscriptions registered but the test ping did not arrive. Click again to retry, or wait for the next real event.',
        });
      } else {
        showToast({
          tone: 'error',
          title: 'Configuration push failed',
          description: result.warning ?? 'Erli did not accept the webhook registration.',
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

  return (
    <div className="action-list__item">
      <div>
        <strong>Configure webhooks</strong>
        {hasCallbackBaseUrl ? (
          <p className="muted-text">
            Register Erli webhook subscriptions and rotate the webhook secret.
            {webhooksConfigured ? ' Currently configured ✓' : ''}
          </p>
        ) : (
          <p className="muted-text">
            Set <code>callbackBaseUrl</code> on this connection before configuring webhooks. Open{' '}
            <strong>Edit connection</strong>, add <code>callbackBaseUrl</code> (the public
            OpenLinker URL Erli posts webhooks to), then return here.
          </p>
        )}
      </div>
      {hasCallbackBaseUrl && (
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
      )}
    </div>
  );
}
