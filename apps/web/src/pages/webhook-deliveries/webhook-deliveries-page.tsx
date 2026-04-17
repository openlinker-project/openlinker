import type { ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { StatusBadge } from '../../shared/ui/status-badge';
import { useWebhookDeliveriesQuery } from '../../features/webhook-deliveries/hooks/use-webhook-deliveries-query';
import {
  WEBHOOK_DELIVERY_STATUS_VALUES,
  type WebhookDeliveryFilters,
  type WebhookDeliveryStatus,
  type WebhookDeliverySummary,
} from '../../features/webhook-deliveries/api/webhook-deliveries.types';

const PAGE_SIZE = 20;

function statusTone(status: WebhookDeliveryStatus): 'success' | 'error' | 'warning' | 'neutral' | 'info' {
  switch (status) {
    case 'published':
    case 'job_enqueued':
      return 'success';
    case 'rejected':
    case 'failed':
    case 'deadlettered':
      return 'error';
    case 'received':
      return 'info';
    default:
      return 'neutral';
  }
}

const COLUMNS: DataTableColumn<WebhookDeliverySummary>[] = [
  {
    id: 'status',
    header: 'Status',
    cell: (d) => <StatusBadge tone={statusTone(d.status)}>{d.status}</StatusBadge>,
  },
  {
    id: 'provider',
    header: 'Provider',
    cell: (d) => <span className="mono-text">{d.provider}</span>,
  },
  {
    id: 'eventType',
    header: 'Event type',
    cell: (d) => <span className="mono-text">{d.eventType ?? '—'}</span>,
  },
  {
    id: 'connectionId',
    header: 'Connection',
    cell: (d) => <span className="mono-text">{d.connectionId}</span>,
  },
  {
    id: 'reason',
    header: 'Reason',
    cell: (d) => {
      const reason = d.rejectionReason ?? d.dlqReason;
      if (!reason) return <span className="text-muted">—</span>;
      return (
        <span className="mono-text" title={reason}>
          {reason.length > 60 ? `${reason.slice(0, 60)}…` : reason}
        </span>
      );
    },
  },
  {
    id: 'receivedAt',
    header: 'Received',
    cell: (d) => new Date(d.receivedAt).toLocaleString(),
  },
  {
    id: 'detail',
    header: '',
    cell: (d) => (
      <Link to={d.id} className="button button--ghost button--compact">
        View
      </Link>
    ),
  },
];

export function WebhookDeliveriesPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();

  const provider = searchParams.get('provider') ?? undefined;
  const connectionId = searchParams.get('connectionId') ?? undefined;
  const status = (searchParams.get('status') as WebhookDeliveryStatus | null) ?? undefined;
  const offset = Number(searchParams.get('offset') ?? '0');

  const filters: WebhookDeliveryFilters = { provider, connectionId, status };
  const query = useWebhookDeliveriesQuery(filters, { limit: PAGE_SIZE, offset });

  function setFilter(key: string, value: string): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete('offset');
      return next;
    });
  }

  function setOffset(next: number): void {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === 0) p.delete('offset');
      else p.set('offset', String(next));
      return p;
    });
  }

  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <PageLayout
      eyebrow="Operations"
      title="Webhook Deliveries"
      description="Inbound webhook visibility — signature, dedup, publish, and downstream job linkage."
    >
      <div className="toolbar">
        <select
          aria-label="Filter by status"
          value={status ?? ''}
          onChange={(e) => { setFilter('status', e.target.value); }}
        >
          <option value="">All statuses</option>
          {WEBHOOK_DELIVERY_STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <input
          aria-label="Filter by provider"
          placeholder="Provider (e.g. prestashop)"
          value={provider ?? ''}
          onChange={(e) => { setFilter('provider', e.target.value); }}
        />

        <input
          aria-label="Filter by connection ID"
          placeholder="Connection ID"
          value={connectionId ?? ''}
          onChange={(e) => { setFilter('connectionId', e.target.value); }}
        />
      </div>

      {query.isLoading ? (
        <LoadingState
          liveRegion="off"
          title="Loading deliveries"
          message="Fetching webhook delivery data…"
        />
      ) : query.error ? (
        <ErrorState
          title="Unable to load webhook deliveries"
          message={query.error.message}
          action={<Button onClick={() => { void query.refetch(); }}>Retry</Button>}
        />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          liveRegion="off"
          title="No deliveries found"
          message={
            provider || connectionId || status
              ? 'No deliveries match the current filters. Try clearing some filters.'
              : 'No webhook deliveries have been recorded yet.'
          }
        />
      ) : (
        <>
          <DataTable
            caption="Webhook deliveries"
            columns={COLUMNS}
            rows={query.data?.items ?? []}
            rowKey={(d) => d.id}
          />

          <div className="pagination">
            <span className="text-muted">
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <div className="pagination__actions">
              <Button disabled={!hasPrev} onClick={() => { setOffset(offset - PAGE_SIZE); }}>
                Previous
              </Button>
              <Button disabled={!hasNext} onClick={() => { setOffset(offset + PAGE_SIZE); }}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </PageLayout>
  );
}
