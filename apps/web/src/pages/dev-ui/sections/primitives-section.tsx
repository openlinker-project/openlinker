/**
 * Primitives section (#775)
 *
 * Kitchen-sink gallery of every primitive in `shared/ui/`. For each
 * component the page renders the tone × size × state matrix that
 * matters, so a developer can copy the live example into a feature
 * without spelunking the source.
 *
 * @module pages/dev-ui/sections
 */
import type { ReactElement, ReactNode } from 'react';
import {
  Alert,
  BackLink,
  Button,
  EmptyState,
  EntityLabel,
  ErrorState,
  FormField,
  Input,
  KpiCard,
  KeyValueList,
  LoadingState,
  MetricCard,
  RawPayloadPanel,
  Select,
  StatusBadge,
  Textarea,
} from '../../../shared/ui';

interface GroupProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

function Group({ title, description, children }: GroupProps): ReactElement {
  return (
    <section className="ds-section">
      <h3 className="ds-section__title">{title}</h3>
      {description ? <p className="ds-section__sub">{description}</p> : null}
      <div className="ds-surface ds-stack">{children}</div>
    </section>
  );
}

const SPARKLINE_TREND: readonly number[] = [4, 6, 5, 8, 7, 9, 10, 12, 11, 14, 13, 16, 15, 18];

export function PrimitivesSection(): ReactElement {
  return (
    <div className="ds-stack" style={{ gap: 'var(--space-6)' }}>
      <Group
        title="Button"
        description="Four tones (primary / secondary / ghost / danger), four sizes (xs / sm / md / lg). Default tone is primary."
      >
        <div className="ds-row">
          <Button tone="primary">Save changes</Button>
          <Button tone="secondary">Cancel</Button>
          <Button tone="ghost">View history</Button>
          <Button tone="danger">Delete connection</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="ds-row">
          <Button tone="primary" className="button--xs">Approve</Button>
          <Button tone="primary" className="button--sm">Approve</Button>
          <Button tone="primary" className="button--md">Approve</Button>
          <Button tone="primary" className="button--lg">Approve</Button>
        </div>
        <div className="ds-row">
          <Button tone="secondary"><span aria-hidden="true">＋</span> Add connection</Button>
          <Button tone="ghost"><span aria-hidden="true">⟳</span> Sync now</Button>
        </div>
      </Group>

      <Group
        title="Form controls"
        description="Input, Select, Textarea — 32 px height (controls), shared focus ring, invalid state mirrors danger tone."
      >
        <div className="ds-grid ds-grid--2">
          <FormField
            label="Connection name"
            name="ds-connection-name"
            description="Operator-facing label."
          >
            <Input defaultValue="Main Allegro store" />
          </FormField>
          <FormField label="Adapter" name="ds-adapter">
            <Select defaultValue="allegro.publicapi.v1">
              <option value="allegro.publicapi.v1">allegro.publicapi.v1</option>
              <option value="prestashop.webservice.v1">prestashop.webservice.v1</option>
              <option value="shopify.admin.v2">shopify.admin.v2</option>
            </Select>
          </FormField>
          <FormField
            label="Buyer email"
            name="ds-buyer-email"
            error="Enter a valid email address."
          >
            <Input defaultValue="not-an-email" invalid />
          </FormField>
          <FormField
            label="Webhook endpoint"
            name="ds-webhook"
            description="Read-only."
          >
            <Input defaultValue="https://api.openlinker.com/webhooks/allegro/c_4f8a" disabled />
          </FormField>
          <FormField label="Notes" name="ds-notes">
            <Textarea placeholder="Operational notes for the team…" rows={3} />
          </FormField>
        </div>
      </Group>

      <Group
        title="StatusBadge"
        description="Mono + caps treatment so status reads as a label. Dot is the secondary signal (colour is never the only signal). `pulse` animates the dot for live states; `solid` is the high-emphasis variant."
      >
        <div className="ds-row">
          <StatusBadge withDot>Idle</StatusBadge>
          <StatusBadge tone="info" pulse>Syncing</StatusBadge>
          <StatusBadge tone="success" withDot>Live</StatusBadge>
          <StatusBadge tone="warning" withDot>Stale 14m</StatusBadge>
          <StatusBadge tone="error" withDot>Failed</StatusBadge>
          <StatusBadge tone="review" withDot>Needs review</StatusBadge>
          <StatusBadge solid>Draft</StatusBadge>
        </div>
      </Group>

      <Group
        title="Alert"
        description="Left-rule accent indicates tone; the body holds the description. Use for inline operator notices, not for transient toasts."
      >
        <Alert tone="success" title="Connection verified">
          Reached <span className="mono">allegro.publicapi.v1</span> in 312 ms.
        </Alert>
        <Alert tone="warning" title="Token expires in 6 days">
          Refresh credentials before <span className="mono">2026-05-23</span> to avoid sync failures.
        </Alert>
        <Alert tone="error" title="Offer rejected by Allegro">
          Category 257 requires brand parameter. <a href="#alert-detail">View 3 affected offers →</a>
        </Alert>
        <Alert tone="info" title="Webhook signature rotated">
          All inbound webhooks will use the new HMAC key starting next sync.
        </Alert>
      </Group>

      <Group
        title="Feedback states"
        description="Empty / Loading / Error — the canonical trio every data view must render."
      >
        <div className="ds-grid ds-grid--3">
          <EmptyState
            title="No connections yet"
            message="Connect a marketplace or shop to start syncing orders."
            action={<Button tone="primary" className="button--sm">Add connection</Button>}
          />
          <LoadingState
            title="Resolving 1,284 mappings"
            message="Building the offer↔product link table. This usually takes 30–60 seconds."
          />
          <ErrorState
            title="We couldn't reach Allegro"
            message="HTTP 503 from api.allegro.pl. Retry usually clears this."
            action={<Button tone="secondary" className="button--sm">Retry</Button>}
          />
        </div>
      </Group>

      <Group
        title="KPI & metric cards"
        description="Numbers come first; everything else recedes. Subtle accent rule across the top edge (added by `.kpi-card`)."
      >
        <div className="ds-grid ds-grid--4">
          <KpiCard
            label="Orders · 7d"
            value="2,847"
            tone="success"
            sparkline={SPARKLINE_TREND}
            sparklineAriaLabel="Orders trend over 14 days"
            description="▲ 12.4% vs previous 7d"
          />
          <KpiCard
            label="Revenue · MTD"
            value="€184,902"
            tone="success"
            description="▲ 8.1% vs April"
          />
          <KpiCard
            label="Sync failures · 24h"
            value="14"
            tone="error"
            description="▲ 3 since 02:00"
          />
          <KpiCard
            label="Active offers"
            value="8,412"
            tone="neutral"
            description="Allegro 4,902 · PrestaShop 3,510"
          />
        </div>
        <div className="ds-grid ds-grid--4">
          <MetricCard label="Open orders" value="142" />
          <MetricCard label="Avg ingest lag" value="42 s" />
          <MetricCard label="Webhook QPS" value="3.8" />
          <MetricCard label="Channels live" value="4 / 6" tone="info" />
        </div>
      </Group>

      <Group
        title="EntityLabel"
        description="Canonical identity row — human name + internal id with copy-to-clipboard."
      >
        <div className="ds-row">
          <EntityLabel id="ol_order_a4f3b9c" name="ALG-2026-05-17-882414" to="#" />
          <EntityLabel id="ol_order_b18e4d1" name="PS-104822" to="#" />
          <EntityLabel id="ol_order_c0271fa" name="AM-202-9920381" to="#" />
        </div>
      </Group>

      <Group
        title="KeyValueList & RawPayloadPanel"
        description="Detail-view pair: human-readable summary on the left, raw bytes on the right."
      >
        <div className="ds-grid ds-grid--2">
          <KeyValueList
            items={[
              { id: 'internal', label: 'Internal id', mono: true, value: 'ol_order_a4f3b9c' },
              { id: 'external', label: 'External id', mono: true, value: 'ALG-2026-05-17-882414' },
              { id: 'channel', label: 'Channel', value: <span className="channel-pill" data-channel="allegro">Allegro · Main</span> },
              { id: 'total', label: 'Total', mono: true, value: '€84.20' },
              { id: 'status', label: 'Status', value: <StatusBadge tone="success" withDot>Paid</StatusBadge> },
              { id: 'created', label: 'Created', mono: true, value: '2026-05-17 14:22 UTC+02' },
            ]}
          />
          <RawPayloadPanel
            defaultOpen
            payload={{
              externalOrderId: 'ALG-2026-05-17-882414',
              status: 'PAID',
              total: { amount: 84.20, currency: 'EUR' },
              lineItems: [
                { sku: 'SKU-9182', qty: 2, price: 29.95 },
                { sku: 'SKU-3310', qty: 1, price: 24.30 },
              ],
              shipping: { method: 'INPOST_LOCKER' },
            }}
          />
        </div>
      </Group>

      <Group
        title="Checkbox & Radio"
        description="Native HTML controls styled via `accent-color` so they pick up the brand orange without rebuilding the indicator."
      >
        <div className="ds-row" style={{ gap: 'var(--space-5)' }}>
          <label className="ds-row" style={{ gap: 'var(--space-2)', cursor: 'pointer' }}>
            <input type="checkbox" defaultChecked />
            <span style={{ fontSize: '0.8125rem' }}>Sync inventory automatically</span>
          </label>
          <label className="ds-row" style={{ gap: 'var(--space-2)', cursor: 'pointer' }}>
            <input type="checkbox" />
            <span style={{ fontSize: '0.8125rem' }}>Enable webhook signatures</span>
          </label>
          <label className="ds-row" style={{ gap: 'var(--space-2)', cursor: 'not-allowed' }}>
            <input type="checkbox" disabled />
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-disabled)' }}>Locked option</span>
          </label>
        </div>
        <div className="ds-row" style={{ gap: 'var(--space-5)' }}>
          <label className="ds-row" style={{ gap: 'var(--space-2)', cursor: 'pointer' }}>
            <input type="radio" name="ds-radio" defaultChecked />
            <span style={{ fontSize: '0.8125rem' }}>Hourly</span>
          </label>
          <label className="ds-row" style={{ gap: 'var(--space-2)', cursor: 'pointer' }}>
            <input type="radio" name="ds-radio" />
            <span style={{ fontSize: '0.8125rem' }}>Daily</span>
          </label>
          <label className="ds-row" style={{ gap: 'var(--space-2)', cursor: 'pointer' }}>
            <input type="radio" name="ds-radio" />
            <span style={{ fontSize: '0.8125rem' }}>Manual only</span>
          </label>
        </div>
      </Group>

      <Group title="BackLink">
        <BackLink to="#" label="Back to orders" />
      </Group>
    </div>
  );
}
