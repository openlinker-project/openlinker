/**
 * Shopify Connection Actions
 *
 * Plugin-owned action row for Shopify connections (#3982): "Configure
 * webhooks" (#3981). Subscribes the store to order topics when Order source is
 * enabled and product topics when Product master is; the backend picks the
 * set, removes topics no capability needs any more, and refuses with neither.
 * Shopify has no test ping, so success means the store accepted every
 * subscription.
 *
 * The button is disabled until a callback URL is saved: the install reads the
 * stored config, so an unsaved URL in the form would not be used.
 *
 * @module plugins/shopify/components
 */
import type { ReactElement } from 'react';
import { useConfigureWebhooksMutation } from '../../../features/connections';
import type { Connection } from '../../../features/connections';
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { Button } from '../../../shared/ui/button';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useToast } from '../../../shared/ui/toast-provider';
import { useShopifyMessages } from '../messages';

interface ShopifyConnectionActionsProps {
  connection: Connection;
  readOnly?: boolean;
}

function readConfig(connection: Connection): Record<string, unknown> {
  return typeof connection.config === 'object' && connection.config !== null
    ? (connection.config as Record<string, unknown>)
    : {};
}

export function ShopifyConnectionActions({
  connection,
  readOnly = false,
}: ShopifyConnectionActionsProps): ReactElement {
  const configureWebhooks = useConfigureWebhooksMutation();
  const { showToast } = useToast();
  const copy = useShopifyMessages().actions;

  const config = readConfig(connection);
  const webhooksConfigured = config.webhooksConfigured === true;
  const callbackUrlSaved =
    typeof config.openlinkerCallbackBaseUrl === 'string' &&
    config.openlinkerCallbackBaseUrl.trim().length > 0;
  // Mirrors the provisioner's own refusal, so the button is honest about it.
  const webhookCapabilityEnabled =
    connection.enabledCapabilities.includes('OrderSource') ||
    connection.enabledCapabilities.includes('ProductMaster');

  async function handleConfigureWebhooks(): Promise<void> {
    try {
      const result = await configureWebhooks.mutateAsync(connection.id);
      if (result.webhooksConfigured) {
        showToast({
          tone: 'success',
          title: copy.toast.configuredTitle,
          description: copy.toast.configured,
        });
      } else {
        showToast({
          tone: 'error',
          title: copy.toast.failedTitle,
          description: result.warning ?? copy.toast.notAccepted,
        });
      }
    } catch (error) {
      showToast({
        tone: 'error',
        title: copy.toast.failedTitle,
        description: (error as Error).message,
      });
    }
  }

  const hint = !webhookCapabilityEnabled
    ? copy.needsCapability
    : !callbackUrlSaved
      ? copy.needsCallbackUrl
      : webhooksConfigured
        ? copy.currentlyConfigured
        : null;

  return (
    <div className="action-list__item">
      <div>
        <strong>{copy.title}</strong>
        <p className="muted-text">
          {copy.description}
          {hint ? ` ${hint}` : ''}
        </p>
      </div>
      <ReadOnlyLock active={readOnly} message={demoReadOnlyActionMessage()}>
        <Button
          tone={webhooksConfigured ? 'secondary' : 'primary'}
          disabled={
            configureWebhooks.isPending || readOnly || !webhookCapabilityEnabled || !callbackUrlSaved
          }
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
