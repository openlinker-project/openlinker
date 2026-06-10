/**
 * InPost Webhook Runbook
 *
 * Plugin-owned `ConnectionActions` row for InPost connections (#768). InPost
 * provisions shipment-tracking webhooks **manually** via its integration team
 * (no self-service API), so this is a runbook — not a "configure" button: it
 * surfaces the OL webhook endpoint for this connection + a copy-paste email
 * template the operator sends to InPost. OL authenticates each delivery by HMAC
 * (ADR-021) and refreshes the shipment on every event.
 *
 * @module plugins/inpost/components
 */
import { useMemo, type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { CopyableId } from '../../../shared/ui/copyable-id';
import { useToast } from '../../../shared/ui/toast-provider';
import type { Connection } from '../../../features/connections';

const INPOST_INTEGRATION_EMAIL = 'integration@inpost.pl';

interface InpostWebhookRunbookProps {
  connection: Connection;
}

export function InpostWebhookRunbook({ connection }: InpostWebhookRunbookProps): ReactElement {
  const { showToast } = useToast();

  const webhookUrl = useMemo(
    () => `${window.location.origin}/webhooks/inpost/${connection.id}`,
    [connection.id],
  );

  const emailTemplate = useMemo(
    () =>
      [
        'Hello InPost Integration Team,',
        '',
        'Please enable shipment-tracking webhooks for our account, delivered to:',
        '',
        webhookUrl,
        '',
        'Topic: Shipment.Tracking',
        '',
        'Thank you.',
      ].join('\n'),
    [webhookUrl],
  );

  async function handleCopyEmail(): Promise<void> {
    try {
      await navigator.clipboard?.writeText(emailTemplate);
      showToast({
        tone: 'success',
        title: 'Email template copied',
        description: `Send it to ${INPOST_INTEGRATION_EMAIL} to request webhook provisioning.`,
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Copy failed',
        description: (error as Error).message,
      });
    }
  }

  return (
    <div className="action-list__item">
      <div>
        <strong>Webhook setup (manual)</strong>
        <p className="muted-text">
          InPost provisions shipment-tracking webhooks manually. Email{' '}
          <code className="mono-text">{INPOST_INTEGRATION_EMAIL}</code> with the endpoint below;
          OpenLinker verifies each delivery by HMAC and refreshes the shipment on every event.
          Self-service provisioning is not offered by InPost today.
        </p>
        <CopyableId id={webhookUrl} />
      </div>
      <Button tone="secondary" onClick={() => void handleCopyEmail()}>
        Copy email template
      </Button>
    </div>
  );
}
