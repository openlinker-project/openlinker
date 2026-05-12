/**
 * PrestaShop Connection Actions
 *
 * Plugin-owned action rows rendered inside `ConnectionActionsPanel` for
 * PrestaShop connections. Today: the "Configure webhooks" action (#168 /
 * #583). Owns its mutation hook and toast feedback — the generic
 * actions panel only knows it's rendering a plugin sub-tree.
 *
 * @module plugins/prestashop/components
 */
import { type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { useToast } from '../../../shared/ui/toast-provider';
import { useConfigureWebhooksMutation } from '../../../features/connections';
import type { Connection } from '../../../features/connections';

interface PrestashopConnectionActionsProps {
  connection: Connection;
}

export function PrestashopConnectionActions({
  connection,
}: PrestashopConnectionActionsProps): ReactElement {
  const configureWebhooks = useConfigureWebhooksMutation();
  const { showToast } = useToast();

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
          description: "PrestaShop module updated and verified by a test ping. You're done.",
        });
      } else if (result.webhooksConfigured) {
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

  return (
    <div className="action-list__item">
      <div>
        <strong>Configure webhooks</strong>
        <p className="muted-text">
          Push Base URL, Connection ID, and a freshly-rotated Webhook Secret to the PrestaShop
          module via WS. Verifies with a synchronous test ping.
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
  );
}
