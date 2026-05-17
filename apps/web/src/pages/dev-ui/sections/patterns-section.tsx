/**
 * Patterns section (#775)
 *
 * Composed examples that show the primitives working together as a
 * real screen. The orders-cockpit slice is the headline — replicates
 * the mockup using only real shared/ui primitives.
 *
 * @module pages/dev-ui/sections
 */
import type { ReactElement, ReactNode } from 'react';
import {
  Alert,
  BackLink,
  Button,
  CopyableId,
  DataTable,
  EntityLabel,
  KpiCard,
  MetricCard,
  SetupStepper,
  StatusBadge,
  type DataTableColumn,
} from '../../../shared/ui';

interface OrderRow {
  id: string;
  createdAt: string;
  externalId: string;
  internalId: string;
  channel: 'allegro' | 'prestashop' | 'amazon' | 'shopify';
  buyer: string;
  status: 'paid' | 'syncing' | 'pending' | 'failed' | 'review';
  total: string;
}

const ORDERS: OrderRow[] = [
  { id: '1', createdAt: '14:22', externalId: 'ALG-882414', internalId: 'ol_order_a4f3', channel: 'allegro', buyer: 'Jan Kowalski', status: 'paid', total: '€84.20' },
  { id: '2', createdAt: '14:08', externalId: 'PS-104822', internalId: 'ol_order_b18e', channel: 'prestashop', buyer: 'Anna Wiśniewska', status: 'syncing', total: '€129.40' },
  { id: '3', createdAt: '13:55', externalId: 'AM-9920381', internalId: 'ol_order_c027', channel: 'amazon', buyer: 'Marek Zych', status: 'pending', total: '€42.00' },
  { id: '4', createdAt: '13:40', externalId: 'ALG-881902', internalId: 'ol_order_d4a8', channel: 'allegro', buyer: 'Test Buyer', status: 'failed', total: '€0.00' },
  { id: '5', createdAt: '13:21', externalId: 'SH-1041', internalId: 'ol_order_e992', channel: 'shopify', buyer: 'Tomasz Lis', status: 'review', total: '€312.00' },
  { id: '6', createdAt: '13:05', externalId: 'ALG-881620', internalId: 'ol_order_f021', channel: 'allegro', buyer: 'Ewa Mazur', status: 'paid', total: '€56.00' },
];

const STATUS_TONE: Record<OrderRow['status'], 'success' | 'info' | 'warning' | 'error' | 'review'> = {
  paid: 'success',
  syncing: 'info',
  pending: 'warning',
  failed: 'error',
  review: 'review',
};

const STATUS_LABEL: Record<OrderRow['status'], string> = {
  paid: 'Paid',
  syncing: 'Syncing',
  pending: 'Pending',
  failed: 'Failed',
  review: 'Needs review',
};

const CHANNEL_LABEL: Record<OrderRow['channel'], string> = {
  allegro: 'Allegro',
  prestashop: 'PrestaShop',
  amazon: 'Amazon',
  shopify: 'Shopify',
};

const ORDER_COLUMNS: DataTableColumn<OrderRow>[] = [
  {
    id: 'createdAt',
    header: 'Created',
    cell: (row: OrderRow) => <span className="mono" style={{ color: 'var(--text-secondary)' }}>{row.createdAt}</span>,
  },
  {
    id: 'order',
    header: 'Order',
    cell: (row: OrderRow) => (
      <EntityLabel id={row.internalId} name={row.externalId} />
    ),
  },
  {
    id: 'channel',
    header: 'Channel',
    cell: (row: OrderRow) => (
      <span className="channel-pill" data-channel={row.channel}>{CHANNEL_LABEL[row.channel]}</span>
    ),
  },
  { id: 'buyer', header: 'Buyer', cell: (row: OrderRow) => row.buyer },
  {
    id: 'status',
    header: 'Status',
    cell: (row: OrderRow) => (
      <StatusBadge
        tone={STATUS_TONE[row.status]}
        withDot={row.status !== 'syncing'}
        pulse={row.status === 'syncing'}
      >
        {STATUS_LABEL[row.status]}
      </StatusBadge>
    ),
  },
  {
    id: 'total',
    header: 'Total',
    align: 'right',
    cell: (row: OrderRow) => <span className="mono tabular">{row.total}</span>,
  },
];

interface PatternProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

function Pattern({ title, description, children }: PatternProps): ReactElement {
  return (
    <section className="ds-section">
      <h3 className="ds-section__title">{title}</h3>
      {description ? <p className="ds-section__sub">{description}</p> : null}
      <div className="ds-surface ds-stack">{children}</div>
    </section>
  );
}

export function PatternsSection(): ReactElement {
  return (
    <div className="ds-stack" style={{ gap: 'var(--space-6)' }}>
      <Pattern
        title="Orders cockpit"
        description="KPI strip → status legend → filter chips → dense list. Everything below composed from real shared/ui primitives."
      >
        <div className="ds-row" style={{ justifyContent: 'space-between' }}>
          <div className="ds-stack" style={{ gap: 2 }}>
            <span className="ds-eyebrow">Last 7 days · UTC+02</span>
            <span style={{ fontSize: '1.5rem', fontWeight: 600, letterSpacing: 'var(--tracking-tight)' }}>Orders</span>
          </div>
          <div className="ds-row">
            <Button tone="ghost" className="button--sm">Filters</Button>
            <Button tone="secondary" className="button--sm">Export CSV</Button>
            <Button tone="primary" className="button--sm">Sync now</Button>
          </div>
        </div>

        <div className="ds-grid ds-grid--4">
          <MetricCard label="Open" value="142" />
          <MetricCard label="Paid · 24h" value="512" tone="success" />
          <MetricCard label="Pending" value="38" tone="warning" />
          <MetricCard label="Failed · 24h" value="14" tone="error" />
        </div>

        <DataTable<OrderRow>
          caption="Recent orders"
          columns={ORDER_COLUMNS}
          rows={ORDERS}
          rowKey={(row) => row.id}
        />
      </Pattern>

      <Pattern
        title="Form pattern"
        description="Title + summary alert + KPI strip + form. Demonstrates how the primitives compose into a settings-style page."
      >
        <Alert tone="info" title="Heads up">
          Webhooks will be re-installed on save. Existing event-replay buffers stay intact.
        </Alert>

        <div className="ds-grid ds-grid--4">
          <KpiCard label="Mappings synced" value="1,284" tone="neutral" />
          <KpiCard label="Pending review" value="6" tone="warning" />
          <KpiCard label="Conflicts" value="0" tone="success" />
          <KpiCard label="Last full sync" value="3 m ago" tone="neutral" />
        </div>

        <div className="ds-row" style={{ justifyContent: 'flex-end' }}>
          <Button tone="ghost">Cancel</Button>
          <Button tone="primary">Save changes</Button>
        </div>
      </Pattern>

      <Pattern
        title="Detail page header"
        description="Breadcrumb hint + entity title + identifier + status + secondary actions. Use for /orders/:id, /connections/:id, /listings/:id, etc."
      >
        <BackLink to="#" label="Back to orders" />
        <div className="ds-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="ds-stack" style={{ gap: 'var(--space-2)' }}>
            <span className="ds-eyebrow">Order · Allegro · Main store</span>
            <div className="ds-row" style={{ gap: 'var(--space-3)' }}>
              <h2 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 600, letterSpacing: 'var(--tracking-tight)' }}>
                ALG-2026-05-17-882414
              </h2>
              <StatusBadge tone="success" withDot>Paid</StatusBadge>
            </div>
            <CopyableId id="ol_order_a4f3b9c1d8e2f0a9b6c3d4e5f6a7b8c9" />
          </div>
          <div className="ds-row">
            <Button tone="ghost" className="button--sm">View raw payload</Button>
            <Button tone="secondary" className="button--sm">Resend webhook</Button>
            <Button tone="primary" className="button--sm">Mark fulfilled</Button>
          </div>
        </div>
      </Pattern>

      <Pattern
        title="Setup wizard"
        description="SetupStepper + body + back/next footer. Used by Allegro / PrestaShop / new-integration flows."
      >
        <SetupStepper
          steps={['Create connection', 'Verify credentials', 'Install webhooks', 'Map products', 'Go live']}
          currentStep={2}
          completedSteps={new Set([0, 1])}
        />
        <div className="ds-stack" style={{ gap: 'var(--space-2)' }}>
          <span className="ds-eyebrow">Step 3 of 5</span>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, letterSpacing: 'var(--tracking-tight)' }}>
            Install webhooks
          </h3>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8125rem', maxWidth: '60ch' }}>
            We'll register inbound webhook URLs on your store so order events arrive in seconds, not minutes. You can
            skip this and rely on polling — the catalog still syncs hourly.
          </p>
        </div>
        <div className="ds-row" style={{ justifyContent: 'space-between' }}>
          <Button tone="ghost">← Back</Button>
          <div className="ds-row">
            <Button tone="secondary">Skip, use polling</Button>
            <Button tone="primary">Install webhooks</Button>
          </div>
        </div>
      </Pattern>

      <Pattern
        title="Structured error list"
        description="Replaces the heavy red-pill treatment for repeated error rows. Compact timestamp + collapsed message + tone strip. Click a row to expand."
      >
        <div className="error-list">
          {([
            { id: 'e1', when: '15 May 14:48', tone: 'error', code: 'marketplace.order.sync.failed', msg: 'Missing mapping for order item productRef [connectionId=d80526bf-a859-4ec7-a424-3d12150bf912, typeoffer, externalId=7781451462]' },
            { id: 'e2', when: '15 May 14:46', tone: 'error', code: 'marketplace.order.sync.failed', msg: 'Missing mapping for order item productRef [connectionId=d80526bf-a859-4ec7-a424-3d12150bf912, typeoffer, externalId=7781451462]' },
            { id: 'e3', when: '15 May 14:45', tone: 'warning', code: 'marketplace.offer.sync.retry', msg: 'HTTP 429 from api.allegro.pl — backing off 4s' },
          ] as const).map((e) => (
            <div key={e.id} className={`error-list__row error-list__row--${e.tone}`}>
              <span className="error-list__when mono-text">{e.when}</span>
              <span className="error-list__code mono-text">{e.code}</span>
              <span className="error-list__msg">{e.msg}</span>
            </div>
          ))}
        </div>
      </Pattern>
    </div>
  );
}
