/**
 * InPost Webhook Runbook
 *
 * Plugin-owned `ConnectionActions` row for InPost connections (#768, #1473).
 * InPost's public ShipX API has no webhook-provisioning endpoint, so OpenLinker
 * cannot auto-register webhooks — hence a runbook, not a "Configure webhooks"
 * button. The operator registers the endpoint themselves:
 *
 *   1. Primary path — the InPost Manager dashboard (Organization settings →
 *      "Adresy webhook" → "Dodaj do API"), which offers self-service webhook
 *      registration with a ping-pong verification.
 *   2. Fallback path — a copy-paste email to the InPost integration team, for
 *      accounts without dashboard access or during production onboarding.
 *
 * OpenLinker authenticates every delivery by HMAC-SHA256 (ADR-021) using a
 * shared secret OL generates; the same secret must be configured on the InPost
 * side or OL rejects deliveries with `401 Invalid webhook signature`. This
 * runbook surfaces the endpoint URL (built from the configured public OL API
 * base, falling back to the current origin) and a one-click secret rotation.
 *
 * @module plugins/inpost/components
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { CopyableId } from '../../../shared/ui/copyable-id';
import { useToast } from '../../../shared/ui/toast-provider';
import type { Connection } from '../../../features/connections';
import { useRotateWebhookSecretMutation } from '../../../features/connections';

const INPOST_INTEGRATION_EMAIL = 'integration@inpost.pl';

interface InpostWebhookRunbookProps {
  connection: Connection;
}

/**
 * Resolve the public OpenLinker API base URL that serves inbound webhooks.
 * Prefers the operator-configured `openlinkerCallbackBaseUrl` (set in the InPost
 * structured-config section); falls back to `window.location.origin` only when
 * unset — correct for shared-origin deployments behind one reverse proxy, wrong
 * for split-origin dev/demo where the FE and API run on different hosts (#1473).
 */
function resolveApiBaseUrl(config: Connection['config']): string {
  const configured = config.openlinkerCallbackBaseUrl;
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim().replace(/\/+$/, '');
  }
  return window.location.origin;
}

export function InpostWebhookRunbook({ connection }: InpostWebhookRunbookProps): ReactElement {
  const { showToast } = useToast();
  const rotateSecret = useRotateWebhookSecretMutation();
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  const webhookUrl = useMemo(
    () => `${resolveApiBaseUrl(connection.config)}/webhooks/inpost/${connection.id}`,
    [connection.config, connection.id],
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
        description: `Send it to ${INPOST_INTEGRATION_EMAIL} if you can't self-register in the InPost Manager dashboard.`,
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Copy failed',
        description: (error as Error).message,
      });
    }
  }

  async function handleRotateSecret(): Promise<void> {
    try {
      const result = await rotateSecret.mutateAsync(connection.id);
      setRevealedSecret(result.secret);
      showToast({
        tone: 'success',
        title: 'Webhook secret generated',
        description: 'Copy it now — it is shown only once. Configure the same value in InPost.',
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Could not generate webhook secret',
        description: (error as Error).message,
      });
    }
  }

  return (
    <div className="action-list__item">
      <div>
        <strong>Webhook setup (runbook)</strong>
        <p className="muted-text">
          The ShipX API has no webhook-provisioning endpoint, so OpenLinker can&apos;t register the
          webhook for you. Register it yourself:
        </p>
        <ol className="muted-text">
          <li>
            <strong>Primary — InPost Manager dashboard.</strong> In Organization settings open{' '}
            <em>Adresy webhook</em> → <em>Dodaj do API</em> and add the endpoint below (InPost runs
            a ping-pong verification against it).
          </li>
          <li>
            <strong>Fallback — email the integration team.</strong> If your account has no dashboard
            access, use the template button to email{' '}
            <code className="mono-text">{INPOST_INTEGRATION_EMAIL}</code> the same endpoint.
          </li>
          <li>
            <strong>Generate the HMAC secret.</strong> Click <em>Generate webhook secret</em> below
            and configure the revealed value in InPost so deliveries are signed with it. OpenLinker
            verifies every delivery by HMAC-SHA256 (ADR-021); a missing or mismatched secret is
            rejected with <code className="mono-text">401 Invalid webhook signature</code>.
          </li>
        </ol>
        <CopyableId id={webhookUrl} />
        {revealedSecret ? (
          <Alert
            tone="warning"
            title="Webhook secret (shown once)"
            className="inpost-webhook-runbook__secret"
          >
            Store this now — it can&apos;t be retrieved again. Configure it as the webhook signing
            secret in InPost, then it must match what OpenLinker holds.
            <CopyableId id={revealedSecret} />
          </Alert>
        ) : null}
      </div>
      <div className="action-list__item-actions">
        <Button
          tone="primary"
          onClick={() => void handleRotateSecret()}
          disabled={rotateSecret.isPending}
        >
          {rotateSecret.isPending
            ? 'Generating...'
            : revealedSecret
              ? 'Rotate webhook secret'
              : 'Generate webhook secret'}
        </Button>
        <Button tone="secondary" onClick={() => void handleCopyEmail()}>
          Copy email template
        </Button>
      </div>
    </div>
  );
}
