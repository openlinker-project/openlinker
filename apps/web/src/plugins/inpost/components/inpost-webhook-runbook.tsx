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
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { publicApiBaseUrl } from '../../../shared/config/public-api-base-url';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { CopyableId } from '../../../shared/ui/copyable-id';
import { useToast } from '../../../shared/ui/toast-provider';
import type { Connection } from '../../../features/connections';
import { useRotateWebhookSecretMutation } from '../../../features/connections';
import { interpolate, renderRich } from '../../../shared/i18n';
import { useInpostMessages } from '../messages';

const INPOST_INTEGRATION_EMAIL = 'integration@inpost.pl';

const STEP_PARTS = {
  strong: (chunk: string): ReactNode => <strong>{chunk}</strong>,
  em: (chunk: string): ReactNode => <em>{chunk}</em>,
  code: (chunk: string): ReactNode => <code className="mono-text">{chunk}</code>,
};

interface InpostWebhookRunbookProps {
  connection: Connection;
}

/**
 * Resolve the public OpenLinker API base URL that serves inbound webhooks.
 * Prefers the operator-configured `openlinkerCallbackBaseUrl` (set in the InPost
 * structured-config section); falls back to the API address the web app itself
 * calls, which is the API host on a split-origin deployment too, where the
 * page's own origin would point at the web app (#1473).
 */
function resolveApiBaseUrl(config: Connection['config']): string {
  const configured = config.openlinkerCallbackBaseUrl;
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim().replace(/\/+$/, '');
  }
  return publicApiBaseUrl();
}

export function InpostWebhookRunbook({ connection }: InpostWebhookRunbookProps): ReactElement {
  const copy = useInpostMessages().inpostWebhookRunbook;
  const { showToast } = useToast();
  const rotateSecret = useRotateWebhookSecretMutation();
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  const webhookUrl = useMemo(
    () => `${resolveApiBaseUrl(connection.config)}/webhooks/inpost/${connection.id}`,
    [connection.config, connection.id],
  );

  // A message to InPost, not UI copy: its wording is kept as written and is
  // never translated with the operator's language.
  const emailTemplate = useMemo(
    () => interpolate(copy.emailTemplate, { webhookUrl }),
    [copy.emailTemplate, webhookUrl],
  );

  async function handleCopyEmail(): Promise<void> {
    try {
      await navigator.clipboard?.writeText(emailTemplate);
      showToast({
        tone: 'success',
        title: copy.toast.copied.title,
        description: interpolate(copy.toast.copied.description, {
          email: INPOST_INTEGRATION_EMAIL,
        }),
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: copy.toast.copyFailed,
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
        title: copy.toast.generated.title,
        description: copy.toast.generated.description,
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: copy.toast.generateFailed,
        description: (error as Error).message,
      });
    }
  }

  return (
    <div className="action-list__item">
      <div>
        <strong>{copy.title}</strong>
        <p className="muted-text">{copy.intro}</p>
        <ol className="muted-text">
          <li>{renderRich(copy.steps.primary, STEP_PARTS)}</li>
          <li>
            {renderRich(copy.steps.fallback, STEP_PARTS, { email: INPOST_INTEGRATION_EMAIL })}
          </li>
          <li>{renderRich(copy.steps.hmac, STEP_PARTS)}</li>
        </ol>
        <CopyableId id={webhookUrl} />
        {revealedSecret ? (
          <Alert
            tone="warning"
            title={copy.secretAlert.title}
            className="inpost-webhook-runbook__secret"
          >
            {copy.secretAlert.body}
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
            ? copy.generating
            : revealedSecret
              ? copy.rotate
              : copy.generate}
        </Button>
        <Button tone="secondary" onClick={() => void handleCopyEmail()}>
          {copy.copyEmail}
        </Button>
      </div>
    </div>
  );
}
