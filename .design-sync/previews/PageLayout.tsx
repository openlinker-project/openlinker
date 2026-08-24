import { Button, DataTable, PageLayout, StatusBadge, TimeDisplay } from '@openlinker/web';

interface OrderRow {
  id: string;
  buyer: string;
  source: string;
  total: string;
  status: 'success' | 'warning' | 'error';
  statusLabel: string;
}

const orders: OrderRow[] = [
  {
    id: 'OL-40218',
    buyer: 'M. Kowalska',
    source: 'Allegro · Main',
    total: '249.00 PLN',
    status: 'success',
    statusLabel: 'synced',
  },
  {
    id: 'OL-40217',
    buyer: 'J. Nowak',
    source: 'Allegro · Main',
    total: '1 180.50 PLN',
    status: 'warning',
    statusLabel: 'awaiting mapping',
  },
  {
    id: 'OL-40216',
    buyer: 'P. Zieliński',
    source: 'Erli · Sandbox',
    total: '89.99 PLN',
    status: 'error',
    statusLabel: 'source deleted',
  },
];

const columns = [
  {
    id: 'id',
    header: 'Order',
    cell: (row: OrderRow) => <span className="mono">{row.id}</span>,
  },
  { id: 'buyer', header: 'Buyer', cell: (row: OrderRow) => row.buyer },
  { id: 'source', header: 'Source', cell: (row: OrderRow) => row.source },
  {
    id: 'total',
    header: 'Total',
    align: 'right' as const,
    cell: (row: OrderRow) => <span className="tabular">{row.total}</span>,
  },
  {
    id: 'status',
    header: 'Status',
    cell: (row: OrderRow) => <StatusBadge tone={row.status}>{row.statusLabel}</StatusBadge>,
  },
];

export const ListPage = () => (
  <PageLayout
    eyebrow="Operations"
    title="Orders"
    description="Every order ingested from a connected marketplace or shop, newest first."
    actions={
      <div className="button-group">
        <Button tone="secondary" className="button--sm">
          Export CSV
        </Button>
        <Button tone="primary" className="button--sm">
          Trigger sync
        </Button>
      </div>
    }
    summary={
      <>
        <div className="toolbar__group">
          <span className="toolbar-chip">4 128 orders</span>
          <StatusBadge tone="warning" withDot>
            17 need attention
          </StatusBadge>
        </div>
        <div className="toolbar__group">
          <span className="muted-text">
            Last poll <TimeDisplay iso="2026-08-22T09:14:00Z" format="datetime" />
          </span>
        </div>
      </>
    }
  >
    <DataTable
      caption="Recent orders"
      columns={columns}
      rows={orders}
      rowKey={(row: OrderRow) => row.id}
    />
  </PageLayout>
);

export const DetailPage = () => (
  <PageLayout
    eyebrow="Integration detail"
    title="Allegro · Main store"
    description="Connection overview, configuration, health, and operator actions."
    backTo={{ to: '/connections', label: 'Connections' }}
    actions={
      <div className="button-group">
        <Button tone="primary" className="button--sm">
          Edit connection
        </Button>
        <Button tone="secondary" className="button--sm">
          Mappings
        </Button>
      </div>
    }
    summary={
      <>
        <div className="toolbar__group">
          <span className="toolbar-chip">allegro</span>
          <StatusBadge tone="success">active</StatusBadge>
        </div>
        <div className="toolbar__group">
          <span className="muted-text">
            Created <TimeDisplay iso="2026-02-11T08:02:00Z" format="date" />
          </span>
        </div>
      </>
    }
  >
    <p className="muted-text">
      Adapter <span className="mono">allegro.publicapi.v1</span> · capabilities OrderSource,
      OfferManager.
    </p>
  </PageLayout>
);

export const Minimal = () => (
  <PageLayout title="Sync jobs" description="Queued, running, and dead jobs across every worker.">
    <p className="muted-text">No jobs are queued right now.</p>
  </PageLayout>
);
