/**
 * inFakt Webhook Config
 *
 * Operator UI to finish inFakt webhook setup (#1770). inFakt owns the exchange:
 * it has no webhook-provisioning API and mints the HMAC secret itself, so the
 * operator registers OL's endpoint in the inFakt dashboard (activation is the
 * `verification_code` ping OL echoes automatically) and pastes the
 * inFakt-generated signing secret back into OL - required, since an unsigned
 * delivery is rejected outright. This replaces the deprecated
 * `OPENLINKER_WEBHOOK_SECRET__INFAKT` env var.
 *
 * Lives in the connections feature (not the inFakt plugin) so both the plugin's
 * `ConnectionActions` slot and the create-wizard post-create prompt can render
 * it: a feature can't import a plugin (ESLint boundary), but a plugin can import
 * this feature.
 *
 *   - `InfaktWebhookConfig` — content-only body (no Dialog chrome).
 *   - `InfaktWebhookConfigDialog` — controlled Dialog wrapping the body.
 *
 * @module features/connections/components
 */
import { useMemo, useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useSetWebhookSecretMutation } from '../hooks/use-set-webhook-secret-mutation';
import { useWebhookStatusQuery } from '../hooks/use-webhook-status-query';
import type { Connection, WebhookStatus } from '../api/connections.types';
import {
  INFAKT_WEBHOOK_SECRET_DEFAULT_VALUES,
  infaktWebhookSecretSchema,
  type InfaktWebhookSecretFormSubmission,
  type InfaktWebhookSecretFormValues,
} from './infakt-webhook-secret.schema';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '../../../shared/ui/dialog';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { CopyableId } from '../../../shared/ui/copyable-id';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { useToast } from '../../../shared/ui/toast-provider';

// The events an operator ticks in inFakt's "Nowy webhook" form. Labels are
// inFakt's own (its UI is Polish) so they match the checkboxes verbatim.
// OpenLinker acts on the KSeF-clearance pair; the payment event feeds the
// optional payment-status sync (#1354). Every other event inFakt can send is
// accepted and ignored.
const REQUIRED_INFAKT_EVENTS = [
  'Faktura wysłana do KSeF',
  'Błąd wysyłki faktury do KSeF',
] as const;
const OPTIONAL_INFAKT_EVENTS = ['Faktura oznaczona jako zapłacona'] as const;

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

// Exported so the plugin's ConnectionActions row (#1770) can render the same
// humanized labels instead of leaking the raw `WebhookStatus` enum values.
export function activationLabel(status: WebhookStatus): { tone: StatusBadgeTone; text: string } {
  switch (status.activation) {
    case 'verified':
      return { tone: 'success', text: 'Active · deliveries seen' };
    case 'auth-failing':
      // Deliveries ARE arriving but every one is rejected at signature check
      // (#1814) — distinct from the inert "never registered" case below.
      return { tone: 'error', text: 'Deliveries failing · check secret' };
    default:
      return { tone: 'warning', text: 'Awaiting first event' };
  }
}

export function signatureLabel(status: WebhookStatus): { tone: StatusBadgeTone; text: string } {
  return status.signature === 'configured'
    ? { tone: 'success', text: 'Configured' }
    : { tone: 'warning', text: 'Not configured' };
}

function StatusStrip({
  status,
  isLoading,
  isError,
  onRetry,
}: {
  status: WebhookStatus | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}): ReactElement {
  if (isLoading) {
    return (
      <div className="infakt-webhook__status" aria-live="polite">
        <span className="muted-text">Checking webhook status…</span>
      </div>
    );
  }
  if (isError || !status) {
    return (
      <div className="infakt-webhook__status">
        <span className="muted-text">Couldn&apos;t load webhook status.</span>
        <Button tone="secondary" type="button" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  const activation = activationLabel(status);
  const signature = signatureLabel(status);

  return (
    <div className="infakt-webhook__status">
      <div className="infakt-webhook__status-item">
        <span className="infakt-webhook__status-key">Activation</span>
        <StatusBadge tone={activation.tone} withDot>
          {activation.text}
        </StatusBadge>
      </div>
      <div className="infakt-webhook__status-item">
        <span className="infakt-webhook__status-key">Signature</span>
        <StatusBadge tone={signature.tone} withDot>
          {signature.text}
        </StatusBadge>
      </div>
      {status.lastDeliveryAt ? (
        <div className="infakt-webhook__status-item">
          <span className="infakt-webhook__status-key">Last delivery</span>
          <span className="infakt-webhook__status-val infakt-webhook__status-val--muted mono-text">
            {status.lastDeliveryEvent ?? 'event'} · {status.lastDeliveryResult ?? 'unknown'}
          </span>
        </div>
      ) : null}
      {status.activation === 'auth-failing' ? (
        <Alert tone="error" title="inFakt deliveries are being rejected">
          OpenLinker is receiving deliveries but rejecting every one because the signature
          doesn&apos;t match. Re-copy the HMAC signing secret from inFakt below — the stored secret
          is missing or out of date.
        </Alert>
      ) : null}
    </div>
  );
}

export function InfaktWebhookConfig({ connection }: { connection: Connection }): ReactElement {
  const { showToast } = useToast();
  const setSecret = useSetWebhookSecretMutation();
  const statusQuery = useWebhookStatusQuery(connection.id);
  const [pendingOverwriteOpen, setPendingOverwriteOpen] = useState(false);

  const webhookUrl = useMemo(
    () => `${resolveApiBaseUrl(connection.config)}/webhooks/infakt/${connection.id}`,
    [connection.config, connection.id],
  );

  const form = useForm<InfaktWebhookSecretFormValues, undefined, InfaktWebhookSecretFormSubmission>({
    defaultValues: INFAKT_WEBHOOK_SECRET_DEFAULT_VALUES,
    resolver: zodResolver(infaktWebhookSecretSchema),
  });

  async function persistSecret(values: InfaktWebhookSecretFormSubmission): Promise<void> {
    try {
      await setSecret.mutateAsync({ connectionId: connection.id, secret: values.secret });
      form.reset(INFAKT_WEBHOOK_SECRET_DEFAULT_VALUES);
      showToast({
        tone: 'success',
        title: 'Signing secret saved',
        description: 'OpenLinker will now verify inFakt delivery signatures.',
      });
    } catch {
      // Surfaced inline via setSecret.error below - a single error channel.
    }
  }

  const onSubmit = form.handleSubmit((values) => {
    // A working secret already exists: confirm before overwriting, since the
    // new value breaks deliveries until the operator re-syncs inFakt to match.
    // Skip the confirm when `activation === 'auth-failing'`: the stored secret
    // is wrong (every delivery is being rejected), so re-pasting the correct
    // one is the repair the red alert asks for - there is nothing to break.
    if (
      statusQuery.data?.signature === 'configured' &&
      statusQuery.data?.activation !== 'auth-failing'
    ) {
      setPendingOverwriteOpen(true);
      return;
    }
    void persistSecret(values);
  });

  async function confirmOverwrite(): Promise<void> {
    setPendingOverwriteOpen(false);
    await persistSecret(form.getValues());
  }

  return (
    <div className="infakt-webhook">
      <p className="infakt-webhook__intro muted-text">
        inFakt signs each delivery and mints the secret itself, so OpenLinker can&apos;t register
        the webhook for you. Register the endpoint in inFakt, then paste the secret it shows you.
      </p>

      <StatusStrip
        status={statusQuery.data}
        isLoading={statusQuery.isLoading}
        isError={Boolean(statusQuery.error)}
        onRetry={() => void statusQuery.refetch()}
      />

      <div className="infakt-webhook__exchange">
        <div className="infakt-webhook__lane">
          <span className="infakt-webhook__dir">
            <span className="infakt-webhook__dir-badge">To inFakt</span>
            You register
          </span>
          <p className="infakt-webhook__lane-label">Delivery endpoint</p>
          <CopyableId id={webhookUrl} />

          <p className="infakt-webhook__events-label">Enable these events in inFakt</p>
          <ul className="infakt-webhook__events">
            {REQUIRED_INFAKT_EVENTS.map((event) => (
              <li key={event} className="infakt-webhook__event infakt-webhook__event--req">
                <span className="infakt-webhook__event-mark" aria-hidden="true">
                  ✓
                </span>
                {event}
              </li>
            ))}
            {OPTIONAL_INFAKT_EVENTS.map((event) => (
              <li key={event} className="infakt-webhook__event infakt-webhook__event--opt">
                <span className="infakt-webhook__event-mark" aria-hidden="true">
                  +
                </span>
                {event}
                <span className="infakt-webhook__event-note">optional · payment sync</span>
              </li>
            ))}
          </ul>

          <p className="infakt-webhook__hint muted-text">
            Create the webhook, then open its details and click <strong>Weryfikuj</strong> (status{' '}
            <em>Do weryfikacji</em> &rarr; <em>Aktywny</em>). inFakt POSTs a{' '}
            <code className="mono-text">verification_code</code>; OpenLinker echoes it back
            automatically.
          </p>
        </div>

        <div className="infakt-webhook__seam" aria-hidden="true">
          <span className="infakt-webhook__seam-glyph">&#8646;</span>
        </div>

        <div className="infakt-webhook__lane">
          <span className="infakt-webhook__dir">
            <span className="infakt-webhook__dir-badge">From inFakt</span>
            You paste back
          </span>
          <p className="infakt-webhook__lane-label">HMAC signing secret</p>
          <form className="infakt-webhook__field" onSubmit={(event) => void onSubmit(event)} noValidate>
            <FormField
              label="Signing secret"
              name="secret"
              error={form.formState.errors.secret?.message}
            >
              <Input
                {...form.register('secret')}
                type="password"
                placeholder="Paste secret from inFakt…"
                autoComplete="off"
                className="mono-text"
                invalid={Boolean(form.formState.errors.secret)}
              />
            </FormField>
            <Button tone="primary" type="submit" disabled={setSecret.isPending}>
              {setSecret.isPending ? 'Saving…' : 'Save secret'}
            </Button>
          </form>
          {setSecret.error ? (
            <Alert tone="error" title="Could not save the signing secret">
              {setSecret.error.message}
            </Alert>
          ) : null}
          <p className="infakt-webhook__hint muted-text">
            A signing secret is required for OpenLinker to accept deliveries: open the
            webhook&apos;s details in inFakt &rarr; <em>Sekretny klucz do HMAC</em> and paste that
            value here. OpenLinker then verifies{' '}
            <code className="mono-text">X-Infakt-Signature</code> and rejects mismatches with 401.
          </p>
        </div>
      </div>

      <details className="infakt-webhook__why">
        <summary>Why can&apos;t OpenLinker set this up for me?</summary>
        <p className="muted-text">
          inFakt has no webhook-provisioning API and its form has no secret field: it generates one
          per subscription, shown only in that subscription&apos;s details. So the secret can only
          travel inFakt &rarr; OpenLinker. Don&apos;t rotate the secret from OpenLinker: that mints
          a new server-side value inFakt would never know, breaking every delivery.
        </p>
      </details>

      <ConfirmDialog
        open={pendingOverwriteOpen}
        onOpenChange={setPendingOverwriteOpen}
        title="Replace signing secret?"
        description="This breaks deliveries until inFakt is updated to match."
        confirmLabel="Replace secret"
        isConfirming={setSecret.isPending}
        onConfirm={() => void confirmOverwrite()}
      />
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
