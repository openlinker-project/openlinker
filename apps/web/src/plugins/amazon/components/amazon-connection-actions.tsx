/**
 * Amazon Connection Actions (#4186)
 *
 * "Register notification queue": registers the connection's SQS queue with
 * Amazon's Notifications API and subscribes it to order changes (#4179,
 * through the host's Configure webhooks route). It needs Order source and a
 * saved queue URL, and the install reads the stored config, so an unsaved URL
 * in the form would not be used; the button says when the URL is missing.
 *
 * The registration is idempotent and the provisioner records no "registered"
 * flag on the connection, so the action is always offered and never claims a
 * state it cannot read.
 *
 * @module plugins/amazon/components
 */
import type { ReactElement } from 'react';
import { useConfigureWebhooksMutation } from '../../../features/connections';
import type { Connection } from '../../../features/connections';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { Button } from '../../../shared/ui/button';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useToast } from '../../../shared/ui/toast-provider';
import { useAmazonMessages } from '../messages';

interface AmazonConnectionActionsProps {
  connection: Connection;
  readOnly?: boolean;
}

export function AmazonConnectionActions({ connection, readOnly = false }: AmazonConnectionActionsProps): ReactElement | null {
  const configure = useConfigureWebhooksMutation();
  const { showToast } = useToast();
  const copy = useAmazonMessages().actions;

  // Notifications only feed orders, so the action belongs to Order source.
  if (!connection.enabledCapabilities.includes('OrderSource')) {
    return null;
  }

  const queueSaved =
    typeof connection.config.notificationQueueUrl === 'string' &&
    connection.config.notificationQueueUrl.trim().length > 0;

  async function handleRegister(): Promise<void> {
    try {
      const result = await configure.mutateAsync(connection.id);
      if (result.webhooksConfigured) {
        showToast({ tone: 'success', title: copy.toast.registeredTitle, description: copy.toast.registered });
      } else {
        showToast({
          tone: 'error',
          title: copy.toast.failedTitle,
          description: result.warning ?? copy.toast.notAccepted,
        });
      }
    } catch (error) {
      showToast({ tone: 'error', title: copy.toast.failedTitle, description: describeApiError(error, 'amazon') });
    }
  }

  const hint = queueSaved ? null : copy.needsQueue;

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
          tone="secondary"
          disabled={configure.isPending || readOnly || !queueSaved}
          onClick={() => void handleRegister()}
        >
          {configure.isPending ? copy.registering : copy.register}
        </Button>
      </ReadOnlyLock>
    </div>
  );
}
