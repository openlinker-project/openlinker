/**
 * inFakt Webhook ConnectionActions
 *
 * The `ConnectionActions` slot row for inFakt connections (#1770): a compact
 * status summary + a "Configure webhooks…" button that opens the shared
 * `InfaktWebhookConfigDialog`. The dialog body lives in the connections feature
 * (so the create-wizard can reuse it without crossing the features -> plugins
 * ESLint boundary); this plugin file just wires it into the slot.
 *
 * @module plugins/infakt/components
 */
import { useState, type ReactElement } from 'react';
import {
  InfaktWebhookConfigDialog,
  useWebhookStatusQuery,
  type Connection,
} from '../../../features/connections';
import { Button } from '../../../shared/ui/button';

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
