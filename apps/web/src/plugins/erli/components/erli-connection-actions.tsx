/**
 * Erli Connection Actions
 *
 * Plugin-owned action rows rendered inside `ConnectionActionsPanel` for
 * Erli connections. Exposes the "Configure webhooks" action (#1216) — guards
 * against a missing `config.callbackBaseUrl` (required by the backend before
 * it can register Erli webhook subscriptions) with an instructional message
 * instead of surfacing a raw 400. The hint now points at the dedicated
 * "Callback URL" field (`ErliStructuredSection`, #1454 follow-up) rather than
 * the raw-JSON config block.
 *
 * @module plugins/erli/components
 */
import type { ReactElement } from 'react';
import type { Connection } from '../../../features/connections';
import { useConfigureWebhooksMutation } from '../../../features/connections';
import { Button } from '../../../shared/ui/button';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { useToast } from '../../../shared/ui/toast-provider';
import { renderRich } from '../../../shared/i18n';
import { useErliMessages } from '../messages';

interface ErliConnectionActionsProps {
  connection: Connection;
  readOnly?: boolean;
}

export function ErliConnectionActions({
  connection,
  readOnly = false,
}: ErliConnectionActionsProps): ReactElement {
  const configureWebhooks = useConfigureWebhooksMutation();
  const { showToast } = useToast();
  const copy = useErliMessages().erliConnectionActions;

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
        description: (error as Error).message,
      });
    }
  }

  return (
    <div className="action-list__item">
      <div>
        <strong>{copy.title}</strong>
        {hasCallbackBaseUrl ? (
          <p className="muted-text">
            {copy.description}
            {webhooksConfigured ? ` ${copy.currentlyConfigured}` : ''}
          </p>
        ) : (
          <p className="muted-text">
            {renderRich(copy.callbackUrlMissing, { strong: (text) => <strong>{text}</strong> })}
          </p>
        )}
      </div>
      {hasCallbackBaseUrl && (
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
      )}
    </div>
  );
}
