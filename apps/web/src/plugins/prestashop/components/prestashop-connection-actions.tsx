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
import type { ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { useToast } from '../../../shared/ui/toast-provider';
import { useConfigureWebhooksMutation } from '../../../features/connections';
import type { Connection } from '../../../features/connections';
import { usePrestashopMessages } from '../messages';
import { describeApiError } from '../../../shared/api/describe-api-error';

interface PrestashopConnectionActionsProps {
  connection: Connection;
  readOnly?: boolean;
}

export function PrestashopConnectionActions({
  connection,
  readOnly = false,
}: PrestashopConnectionActionsProps): ReactElement {
  const copy = usePrestashopMessages().prestashopConnectionActions;
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
          title: copy.toast.configured.title,
          description: copy.toast.configured.description,
        });
      } else if (result.webhooksConfigured) {
        showToast({
          tone: 'warning',
          title: copy.toast.pingMissing.title,
          description: copy.toast.pingMissing.description,
        });
      } else {
        showToast({
          tone: 'error',
          title: copy.toast.failed.title,
          description: result.warning ?? copy.toast.failed.notAccepted,
        });
      }
    } catch (error) {
      showToast({
        tone: 'error',
        title: copy.toast.failed.title,
        description: describeApiError(error, 'prestashop'),
      });
    }
  }

  return (
    <div className="action-list__item">
      <div>
        <strong>{copy.title}</strong>
        <p className="muted-text">
          {copy.description}
          {webhooksConfigured ? ` ${copy.currentlyConfigured}` : ''}
        </p>
      </div>
      <ReadOnlyLock active={readOnly} message={demoReadOnlyActionMessage()}>
        <Button
          tone={webhooksConfigured ? 'secondary' : 'primary'}
          disabled={configureWebhooks.isPending || readOnly}
          onClick={() => void handleConfigureWebhooks()}
        >
          {configureWebhooks.isPending
            ? copy.configuring
            : webhooksConfigured
              ? copy.reconfigure
              : copy.configure}
        </Button>
      </ReadOnlyLock>
    </div>
  );
}
