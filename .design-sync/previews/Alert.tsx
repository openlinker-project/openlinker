import { Alert, Button } from '@openlinker/web';

const stack = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 12,
};

export const Tones = () => (
  <div style={stack}>
    <Alert tone="info" title="Webhook signature rotated">
      All inbound webhooks will use the new HMAC key starting next sync.
    </Alert>
    <Alert tone="success" title="Connection verified">
      Reached <span className="mono">allegro.publicapi.v1</span> in 312 ms.
    </Alert>
    <Alert tone="warning" title="Token expires in 6 days">
      Refresh credentials before <span className="mono">2026-05-23</span> to avoid sync failures.
    </Alert>
    <Alert tone="error" title="Offer rejected by Allegro">
      Category 257 requires a brand parameter. 3 offers in this batch are affected.
    </Alert>
  </div>
);

export const WithAction = () => (
  <div style={stack}>
    <Alert
      tone="warning"
      title="Webhooks will be re-installed on save"
      action={
        <Button tone="secondary" className="button--sm">
          Review changes
        </Button>
      }
    >
      Existing event-replay buffers stay intact. Deliveries paused for roughly 4 seconds.
    </Alert>
    <Alert
      tone="error"
      title="Inventory sync halted"
      action={
        <Button tone="primary" className="button--sm">
          Retry sync
        </Button>
      }
    >
      HTTP 503 from <span className="mono">api.allegro.pl</span> on 12 consecutive attempts.
    </Alert>
  </div>
);

export const BodyOnly = () => (
  <div style={stack}>
    <Alert tone="info">
      MCP tools follow these capabilities — an already-connected agent must reconnect to see a
      change.
    </Alert>
    <Alert tone="success">
      Reconciled 1,284 offer mappings. No drift detected against the master catalogue.
    </Alert>
  </div>
);
