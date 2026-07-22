/**
 * inFakt Webhook Config
 *
 * Operator UI to finish inFakt webhook setup (#1770). inFakt owns the exchange:
 * it has no webhook-provisioning API and mints the HMAC secret itself, so the
 * operator registers OL's endpoint in the inFakt dashboard (activation is the
 * `verification_code` ping OL echoes automatically) and — optionally — pastes
 * the inFakt-generated signing secret back into OL. This replaces the
 * deprecated `OPENLINKER_WEBHOOK_SECRET__INFAKT` env var.
 *
 * Three pieces:
 *   - `InfaktWebhookConfig` — content-only modal body (no Dialog chrome).
 *   - `InfaktWebhookConfigDialog` — controlled Dialog wrapping the body.
 *   - `InfaktWebhookConnectionActions` — the `ConnectionActions` slot row
 *     (status summary + "Configure webhooks…" trigger). Also reused by the
 *     create-wizard finish step.
 *
 * @module plugins/infakt/components
 */
import { useMemo, useState, type ReactElement } from 'react';
import {
  useSetWebhookSecretMutation,
  useWebhookStatusQuery,
  type Connection,
  type WebhookStatus,
} from '../../../features/connections';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { CopyableId } from '../../../shared/ui/copyable-id';
import { Input } from '../../../shared/ui/input';
import { useToast } from '../../../shared/ui/toast-provider';

const SUBSCRIBED_EVENTS = ['send_to_ksef_success', 'send_to_ksef_error'] as const;
const OPTIONAL_EVENTS = ['invoice_marked_as_paid'] as const;

/**
 * Resolve the public OpenLinker host that serves inbound webhooks. Prefers an
 * operator-configured callback base, falling back to the current origin (correct
 * for shared-origin deployments; an operator on a split-origin setup sets the
 * override). Mirrors the InPost runbook's resolution.
 */
function resolveApiBaseUrl(config: Connection['config']): string {
  const configured = config?.openlinkerCallbackBaseUrl;
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim().replace(/\/+$/, '');
  }
  return window.location.origin;
}

function activationLabel(status: WebhookStatus): { tone: string; text: string } {
  return status.activation === 'verified'
    ? { tone: 'ok', text: 'Verified · ping echoed' }
    : { tone: 'warn', text: 'Awaiting registration' };
}

function signatureLabel(status: WebhookStatus): { tone: string; text: string } {
  switch (status.signature) {
    case 'configured':
      return { tone: 'ok', text: 'Configured' };
    case 'mismatch':
      return { tone: 'err', text: 'Signature mismatch' };
    default:
      return { tone: 'warn', text: 'Not configured' };
  }
}

function StatusStrip({ connectionId }: { connectionId: string }): ReactElement {
  const statusQuery = useWebhookStatusQuery(connectionId);

  if (statusQuery.isLoading) {
    return (
      <div className="infakt-webhook__status" aria-live="polite">
        <span className="muted-text">Checking webhook status…</span>
      </div>
    );
  }
  if (statusQuery.error || !statusQuery.data) {
    return (
      <div className="infakt-webhook__status">
        <span className="muted-text">Couldn&apos;t load webhook status.</span>
      </div>
    );
  }

  const status = statusQuery.data;
  const activation = activationLabel(status);
  const signature = signatureLabel(status);

  return (
    <div className="infakt-webhook__status">
      <div className="infakt-webhook__status-item">
        <span className="infakt-webhook__status-key">Activation</span>
        <span className={`infakt-webhook__status-val infakt-webhook__status-val--${activation.tone}`}>
          <span className="infakt-webhook__dot" aria-hidden="true" />
          {activation.text}
        </span>
      </div>
      <div className="infakt-webhook__status-item">
        <span className="infakt-webhook__status-key">Signature (optional)</span>
        <span className={`infakt-webhook__status-val infakt-webhook__status-val--${signature.tone}`}>
          <span className="infakt-webhook__dot" aria-hidden="true" />
          {signature.text}
        </span>
      </div>
      {status.lastDeliveryAt ? (
        <div className="infakt-webhook__status-item">
          <span className="infakt-webhook__status-key">Last delivery</span>
          <span className="infakt-webhook__status-val infakt-webhook__status-val--muted mono-text">
            {status.lastDeliveryEvent ?? 'event'} · {status.lastDeliveryResult ?? 'ok'}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function InfaktWebhookConfig({ connection }: { connection: Connection }): ReactElement {
  const { showToast } = useToast();
  const setSecret = useSetWebhookSecretMutation();
  const [secret, setSecret_] = useState('');

  const webhookUrl = useMemo(
    () => `${resolveApiBaseUrl(connection.config)}/webhooks/infakt/${connection.id}`,
    [connection.config, connection.id],
  );

  async function handleSaveSecret(): Promise<void> {
    try {
      await setSecret.mutateAsync({ connectionId: connection.id, secret });
      setSecret_('');
      showToast({
        tone: 'success',
        title: 'Signing secret saved',
        description: 'OpenLinker will now verify inFakt delivery signatures.',
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Could not save the signing secret',
        description: (error as Error).message,
      });
    }
  }

  return (
    <div className="infakt-webhook">
      <p className="infakt-webhook__intro muted-text">
        inFakt signs each delivery and mints the secret itself — OpenLinker can&apos;t register it
        for you. Register the endpoint in inFakt, then optionally paste the secret it shows you.
      </p>

      <StatusStrip connectionId={connection.id} />

      <div className="infakt-webhook__exchange">
        <div className="infakt-webhook__lane">
          <span className="infakt-webhook__dir">
            <span className="infakt-webhook__arrow" aria-hidden="true">
              →
            </span>{' '}
            You register in inFakt
          </span>
          <p className="infakt-webhook__lane-label">Delivery endpoint</p>
          <CopyableId id={webhookUrl} />
          <div className="infakt-webhook__events">
            {SUBSCRIBED_EVENTS.map((event) => (
              <span key={event} className="infakt-webhook__chip infakt-webhook__chip--on">
                {event}
              </span>
            ))}
            {OPTIONAL_EVENTS.map((event) => (
              <span key={event} className="infakt-webhook__chip">
                {event}
              </span>
            ))}
          </div>
          <p className="infakt-webhook__hint muted-text">
            Paste this in inFakt → Webhooks and click <strong>Zweryfikuj</strong>. inFakt sends a{' '}
            <code className="mono-text">verification_code</code>; OpenLinker echoes it back
            automatically to activate the subscription.
          </p>
        </div>

        <div className="infakt-webhook__seam" aria-hidden="true">
          <span className="infakt-webhook__seam-glyph">⇄</span>
        </div>

        <div className="infakt-webhook__lane">
          <span className="infakt-webhook__dir">
            <span className="infakt-webhook__arrow" aria-hidden="true">
              ←
            </span>{' '}
            inFakt gives you <span className="infakt-webhook__tag">Optional</span>
          </span>
          <p className="infakt-webhook__lane-label">HMAC signing secret</p>
          <div className="infakt-webhook__field">
            <Input
              type="password"
              value={secret}
              onChange={(event) => setSecret_(event.target.value)}
              placeholder="Paste secret from inFakt…"
              autoComplete="off"
              aria-label="inFakt webhook signing secret"
              className="mono-text"
            />
            <Button
              tone="primary"
              type="button"
              onClick={() => void handleSaveSecret()}
              disabled={setSecret.isPending || secret.trim().length === 0}
            >
              {setSecret.isPending ? 'Saving…' : 'Save secret'}
            </Button>
          </div>
          {setSecret.error ? (
            <Alert tone="error" title="Could not save the signing secret">
              {setSecret.error.message}
            </Alert>
          ) : null}
          <p className="infakt-webhook__hint muted-text">
            For extra security, open the webhook&apos;s details in inFakt, copy the auto-generated
            secret, and paste it here. OpenLinker then verifies{' '}
            <code className="mono-text">X-Infakt-Signature</code> and rejects mismatches with 401.
          </p>
        </div>
      </div>

      <details className="infakt-webhook__why">
        <summary>Why can&apos;t OpenLinker set this up for me?</summary>
        <p className="muted-text">
          inFakt has no webhook-provisioning API and its form has no secret field — it generates one
          per subscription, shown only in that subscription&apos;s details. So the secret can only
          travel inFakt → OpenLinker. Don&apos;t rotate the secret from OpenLinker: that mints a new
          server-side value inFakt would never know, breaking every delivery.
        </p>
      </details>
    </div>
  );
}

export function InfaktWebhookConfigDialog({
  connection,
  open,
  onOpenChange,
}: {
  connection: Connection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dialog__content--wide" aria-describedby={undefined}>
        <DialogTitle>Configure webhooks</DialogTitle>
        <InfaktWebhookConfig connection={connection} />
        <DialogFooter>
          <Button tone="secondary" type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InfaktWebhookConnectionActions({
  connection,
}: {
  connection: Connection;
  readOnly?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const statusQuery = useWebhookStatusQuery(connection.id, { enabled: !open });

  const summary = statusQuery.data;

  return (
    <div className="action-list__item">
      <div>
        <strong>Webhook setup</strong>
        <p className="muted-text">
          Deliver KSeF clearance events from inFakt in real time. Register the endpoint and,
          optionally, verify delivery signatures.
        </p>
        {summary ? (
          <div className="infakt-webhook__events" style={{ marginTop: 'var(--space-2)' }}>
            <span
              className={`infakt-webhook__chip ${
                summary.activation === 'verified' ? 'infakt-webhook__chip--on' : ''
              }`}
            >
              Activation: {summary.activation === 'verified' ? 'verified' : 'pending'}
            </span>
            <span
              className={`infakt-webhook__chip ${
                summary.signature === 'configured' ? 'infakt-webhook__chip--on' : ''
              }`}
            >
              Signature: {summary.signature}
            </span>
          </div>
        ) : null}
      </div>
      <div className="action-list__item-actions">
        <Button tone="secondary" type="button" onClick={() => setOpen(true)}>
          Configure webhooks…
        </Button>
      </div>
      <InfaktWebhookConfigDialog connection={connection} open={open} onOpenChange={setOpen} />
    </div>
  );
}
