/**
 * Shoper Connection Actions
 *
 * Plugin-owned action row for Shoper connections: "Configure webhooks"
 * (#3644). Registers one webhook with the shop that calls back into
 * OpenLinker, carrying order events when Order source is enabled and product
 * events when Product master is (the backend picks the set and refuses with
 * neither). Shoper has no test ping, so success means the shop accepted the
 * registration.
 *
 * @module plugins/shoper/components
 */
import type { ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { useToast } from '../../../shared/ui/toast-provider';
import { useShoperMessages } from '../messages';
import { useConfigureWebhooksMutation } from '../../../features/connections';
import type { Connection } from '../../../features/connections';
import { describeApiError } from '../../../shared/api/describe-api-error';

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
  const copy = useShoperMessages().shoperConnectionActions;

  const webhooksConfigured =
    typeof connection.config === 'object' &&
    connection.config !== null &&
    (connection.config as Record<string, unknown>).webhooksConfigured === true;
  // Mirrors the provisioner's own refusal: webhooks need a capability that
  // consumes them. The backend refuses either way; this keeps the button honest.
  const webhookCapabilityEnabled =
    connection.enabledCapabilities.includes('OrderSource') ||
    connection.enabledCapabilities.includes('ProductMaster');

  async function handleConfigureWebhooks(): Promise<void> {
    try {
      const result = await configureWebhooks.mutateAsync(connection.id);
      if (result.webhooksConfigured) {
        showToast({
          tone: 'success',
          title: copy.toast.configured.title,
          description: copy.toast.configured.description,
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
        description: describeApiError(error, 'shoper'),
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
          disabled={configureWebhooks.isPending || readOnly || !webhookCapabilityEnabled}
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
