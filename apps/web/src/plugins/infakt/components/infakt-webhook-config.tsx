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
import {
  useSetWebhookSecretMutation,
  useWebhookStatusQuery,
  type Connection,
  type WebhookStatus,
} from '../../../features/connections';
import {
  INFAKT_WEBHOOK_SECRET_DEFAULT_VALUES,
  createInfaktWebhookSecretSchema,
  type InfaktWebhookSecretFormSubmission,
  type InfaktWebhookSecretFormValues,
} from './infakt-webhook-secret.schema';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '../../../shared/ui/dialog';
import { publicApiBaseUrl } from '../../../shared/config/public-api-base-url';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { CopyableId } from '../../../shared/ui/copyable-id';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { useToast } from '../../../shared/ui/toast-provider';
import { interpolate, renderRich } from '../../../shared/i18n';
import { getInfaktMessages, useInfaktMessages } from '../messages';
import { describeApiError } from '../../../shared/api/describe-api-error';

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

/** Decorative arrow between the two lanes; hidden from assistive tech. */
const SEAM_GLYPH = '\u21C6';

const rich = {
  strong: (text: string): ReactElement => <strong>{text}</strong>,
  em: (text: string): ReactElement => <em>{text}</em>,
  code: (text: string): ReactElement => <code className="mono-text">{text}</code>,
};

/**
 * Resolve the public OpenLinker host that serves inbound webhooks. Prefers an
 * operator-configured callback base, falling back to the API address the web app
 * itself calls (the page's own origin is the web app on a split-origin setup).
 * Mirrors the InPost runbook's resolution.
 */
function resolveApiBaseUrl(config: Connection['config']): string {
  const configured = config?.openlinkerCallbackBaseUrl;
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim().replace(/\/+$/, '');
  }
  return publicApiBaseUrl();
}

// Exported so the plugin's ConnectionActions row (#1770) can render the same
// humanized labels instead of leaking the raw `WebhookStatus` enum values.
// Copy is read when called, so it follows the active language.
export function activationLabel(status: WebhookStatus): { tone: StatusBadgeTone; text: string } {
  const copy = getInfaktMessages().infaktWebhookConfig.activation;
  switch (status.activation) {
    case 'verified':
      return { tone: 'success', text: copy.verified };
    case 'auth-failing':
      // Deliveries ARE arriving but every one is rejected at signature check
      // (#1814) — distinct from the inert "never registered" case below.
      return { tone: 'error', text: copy.authFailing };
    default:
      return { tone: 'warning', text: copy.awaiting };
  }
}

export function signatureLabel(status: WebhookStatus): { tone: StatusBadgeTone; text: string } {
  const copy = getInfaktMessages().infaktWebhookConfig.signature;
  return status.signature === 'configured'
    ? { tone: 'success', text: copy.configured }
    : { tone: 'warning', text: copy.notConfigured };
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
  const copy = useInfaktMessages().infaktWebhookConfig;
  if (isLoading) {
    return (
      <div className="infakt-webhook__status" aria-live="polite">
        <span className="muted-text">{copy.status.checking}</span>
      </div>
    );
  }
  if (isError || !status) {
    return (
      <div className="infakt-webhook__status">
        <span className="muted-text">{copy.status.loadFailed}</span>
        <Button tone="secondary" type="button" onClick={onRetry}>
          {copy.status.retry}
        </Button>
      </div>
    );
  }

  const activation = activationLabel(status);
  const signature = signatureLabel(status);

  return (
    <div className="infakt-webhook__status">
      <div className="infakt-webhook__status-item">
        <span className="infakt-webhook__status-key">{copy.status.activation}</span>
        <StatusBadge tone={activation.tone} withDot>
          {activation.text}
        </StatusBadge>
      </div>
      <div className="infakt-webhook__status-item">
        <span className="infakt-webhook__status-key">{copy.status.signature}</span>
        <StatusBadge tone={signature.tone} withDot>
          {signature.text}
        </StatusBadge>
      </div>
      {status.lastDeliveryAt ? (
        <div className="infakt-webhook__status-item">
          <span className="infakt-webhook__status-key">{copy.status.lastDelivery}</span>
          <span className="infakt-webhook__status-val infakt-webhook__status-val--muted mono-text">
            {interpolate(copy.status.lastDeliveryValue, {
              event: status.lastDeliveryEvent ?? copy.status.unknownEvent,
              result: status.lastDeliveryResult ?? copy.status.unknownResult,
            })}
          </span>
        </div>
      ) : null}
      {status.activation === 'auth-failing' ? (
        <Alert tone="error" title={copy.authFailing.title}>
          {copy.authFailing.body}
        </Alert>
      ) : null}
    </div>
  );
}

export function InfaktWebhookConfig({ connection }: { connection: Connection }): ReactElement {
  const copy = useInfaktMessages().infaktWebhookConfig;
  const schemaCopy = useInfaktMessages().infaktWebhookSecretSchema;
  const secretSchema = useMemo(() => createInfaktWebhookSecretSchema(schemaCopy), [schemaCopy]);
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
    resolver: zodResolver(secretSchema),
  });

  async function persistSecret(values: InfaktWebhookSecretFormSubmission): Promise<void> {
    try {
      await setSecret.mutateAsync({ connectionId: connection.id, secret: values.secret });
      form.reset(INFAKT_WEBHOOK_SECRET_DEFAULT_VALUES);
      showToast({
        tone: 'success',
        title: copy.save.toastTitle,
        description: copy.save.toastDescription,
      });
    } catch {
      // Surfaced inline via setSecret.error below - a single error channel.
    }
  }

  const onSubmit = form.handleSubmit((values) => {
    // A secret already exists: confirm before overwriting, since the new
    // value breaks deliveries until the operator re-syncs inFakt to match.
    if (statusQuery.data?.signature === 'configured') {
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
      <p className="infakt-webhook__intro muted-text">{copy.intro}</p>

      <StatusStrip
        status={statusQuery.data}
        isLoading={statusQuery.isLoading}
        isError={Boolean(statusQuery.error)}
        onRetry={() => void statusQuery.refetch()}
      />

      <div className="infakt-webhook__exchange">
        <div className="infakt-webhook__lane">
          <span className="infakt-webhook__dir">
            <span className="infakt-webhook__dir-badge">{copy.toInfakt}</span>
            {copy.register}
          </span>
          <p className="infakt-webhook__lane-label">{copy.deliveryEndpoint}</p>
          <CopyableId id={webhookUrl} />

          <p className="infakt-webhook__events-label">{copy.enableEvents}</p>
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
                <span className="infakt-webhook__event-note">{copy.optionalNote}</span>
              </li>
            ))}
          </ul>

          <p className="infakt-webhook__hint muted-text">{renderRich(copy.registerHint, rich)}</p>
        </div>

        <div className="infakt-webhook__seam" aria-hidden="true">
          <span className="infakt-webhook__seam-glyph">{SEAM_GLYPH}</span>
        </div>

        <div className="infakt-webhook__lane">
          <span className="infakt-webhook__dir">
            <span className="infakt-webhook__dir-badge">{copy.fromInfakt}</span>
            {copy.pasteBack}
          </span>
          <p className="infakt-webhook__lane-label">{copy.secret.lane}</p>
          <form className="infakt-webhook__field" onSubmit={(event) => void onSubmit(event)} noValidate>
            <FormField
              label={copy.secret.label}
              name="secret"
              error={form.formState.errors.secret?.message}
            >
              <Input
                {...form.register('secret')}
                type="password"
                placeholder={copy.secret.placeholder}
                autoComplete="off"
                className="mono-text"
                invalid={Boolean(form.formState.errors.secret)}
              />
            </FormField>
            <Button tone="primary" type="submit" disabled={setSecret.isPending}>
              {setSecret.isPending ? copy.save.saving : copy.save.submit}
            </Button>
          </form>
          {setSecret.error ? (
            <Alert tone="error" title={copy.save.error}>
              {describeApiError(setSecret.error, 'infakt')}
            </Alert>
          ) : null}
          <p className="infakt-webhook__hint muted-text">{renderRich(copy.secret.hint, rich)}</p>
        </div>
      </div>

      <details className="infakt-webhook__why">
        <summary>{copy.why.summary}</summary>
        <p className="muted-text">{copy.why.body}</p>
      </details>

      <ConfirmDialog
        open={pendingOverwriteOpen}
        onOpenChange={setPendingOverwriteOpen}
        title={copy.overwrite.title}
        description={copy.overwrite.description}
        confirmLabel={copy.overwrite.confirm}
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
  const copy = useInfaktMessages().infaktWebhookConfig.dialog;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dialog__content--wide" aria-describedby={undefined}>
        <DialogTitle>{copy.title}</DialogTitle>
        <InfaktWebhookConfig connection={connection} />
        <DialogFooter>
          <Button tone="secondary" type="button" onClick={() => onOpenChange(false)}>
            {copy.done}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
