import { useMemo, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { useTableSort } from '../../shared/ui/use-table-sort';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Button } from '../../shared/ui/button';
import { Input } from '../../shared/ui/input';
import { Select } from '../../shared/ui/select';
import { StatusBadge } from '../../shared/ui/status-badge';
import { TimeDisplay } from '../../shared/ui/time-display';
import { useWebhookDeliveriesQuery } from '../../features/webhook-deliveries/hooks/use-webhook-deliveries-query';
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import { ConnectionEntityLabel } from '../../features/connections/components/ConnectionEntityLabel';
import {
  WEBHOOK_DELIVERY_STATUS_VALUES,
  type WebhookDeliveryFilters,
  type WebhookDeliveryStatus,
  type WebhookDeliverySummary,
} from '../../features/webhook-deliveries/api/webhook-deliveries.types';
import { webhookDeliveryStatusLabel } from '../../features/webhook-deliveries/lib/webhook-delivery-status-label';
import { interpolate, useMessages, type Messages } from '../../shared/i18n';

type DeliveriesPageCopy = Messages['webhook-deliveries']['webhookDeliveriesPage'];

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

function buildColumns(
  copy: DeliveriesPageCopy['columns'],
): DataTableColumn<WebhookDeliverySummary>[] {
  return [
    {
      id: 'status',
      header: copy.status,
      cell: (d) => (
        <StatusBadge tone={statusTone(d.status)}>{webhookDeliveryStatusLabel(d.status)}</StatusBadge>
      ),
      accessor: (d) => d.status,
      sortable: true,
    },
    {
      id: 'provider',
      header: copy.provider,
      cell: (d) => (
        <span className="mono-text" title={d.provider}>
          {d.provider}
        </span>
      ),
      accessor: (d) => d.provider,
      sortable: true,
    },
    {
      id: 'eventType',
      header: copy.eventType,
      cell: (d) => (
        <span className="mono-text" title={d.eventType ?? undefined}>
          {d.eventType ?? '—'}
        </span>
      ),
      hideBelow: 768,
    },
    {
      id: 'connectionId',
      header: copy.connection,
      cell: (d) => (
        <ConnectionEntityLabel connectionId={d.connectionId} linkToDetail={false} showId />
      ),
      hideBelow: 1024,
    },
    {
      id: 'reason',
      header: copy.reason,
      cell: (d) => {
        const reason = d.rejectionReason ?? d.dlqReason;
        if (!reason) return <span className="text-muted">—</span>;
        return (
          <span className="mono-text" title={reason}>
            {reason.length > 60 ? `${reason.slice(0, 60)}…` : reason}
          </span>
        );
      },
      hideBelow: 1024,
    },
    {
      id: 'receivedAt',
      header: copy.received,
      cell: (d) => <TimeDisplay iso={d.receivedAt} />,
      accessor: (d) => d.receivedAt,
      sortable: true,
    },
  ];
}

export function WebhookDeliveriesPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const copy = useMessages('webhook-deliveries').webhookDeliveriesPage;
  const columns = useMemo(() => buildColumns(copy.columns), [copy]);
  const { sort, setSort } = useTableSort([{ id: 'receivedAt', desc: true }]);

  const provider = searchParams.get('provider') ?? undefined;
  const connectionId = searchParams.get('connectionId') ?? undefined;
  const status = (searchParams.get('status') as WebhookDeliveryStatus | null) ?? undefined;
  const offset = Number(searchParams.get('offset') ?? '0');

  const filters: WebhookDeliveryFilters = { provider, connectionId, status };
  const query = useWebhookDeliveriesQuery(filters, { limit: PAGE_SIZE, offset });
  const connectionsQuery = useConnectionsQuery();
  const connections = connectionsQuery.data ?? [];

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
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
    >
      <div className="toolbar">
        <Select
          aria-label={copy.filters.status}
          value={status ?? ''}
          onChange={(e) => { setFilter('status', e.target.value); }}
        >
          <option value="">{copy.filters.allStatuses}</option>
          {WEBHOOK_DELIVERY_STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {webhookDeliveryStatusLabel(s)}
            </option>
          ))}
        </Select>

        <Input
          aria-label={copy.filters.provider}
          placeholder={copy.filters.providerPlaceholder}
          value={provider ?? ''}
          onChange={(e) => { setFilter('provider', e.target.value); }}
        />

        <Select
          aria-label={copy.filters.connection}
          value={connectionId ?? ''}
          onChange={(e) => { setFilter('connectionId', e.target.value); }}
        >
          <option value="">{copy.filters.allConnections}</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      {query.isLoading ? (
        <DataTableSkeleton columns={columns} />
      ) : query.error ? (
        <ErrorState
          title={copy.errorTitle}
          message={query.error.message}
          action={<Button onClick={() => { void query.refetch(); }}>{copy.retry}</Button>}
        />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          liveRegion="off"
          title={copy.empty.title}
          message={
            provider || connectionId || status
              ? copy.empty.filtered
              : copy.empty.none
          }
        />
      ) : (
        <>
          <DataTable
            caption={copy.caption}
            columns={columns}
            rows={query.data?.items ?? []}
            rowKey={(d) => d.id}
            rowHref={(d) => d.id}
            sort={sort}
            onSortChange={setSort}
            cardView={{
              title: (d) => d.provider,
              subtitle: (d) => d.eventType ?? '—',
              meta: (d) => (
                <StatusBadge tone={statusTone(d.status)} compact>
                  {webhookDeliveryStatusLabel(d.status)}
                </StatusBadge>
              ),
            }}
          />

          <div className="pagination">
            <span className="text-muted">
              {interpolate(copy.pagination.range, {
                from: offset + 1,
                to: Math.min(offset + PAGE_SIZE, total),
                total,
              })}
            </span>
            <div className="pagination__actions">
              <Button disabled={!hasPrev} onClick={() => { setOffset(offset - PAGE_SIZE); }}>
                {copy.pagination.previous}
              </Button>
              <Button disabled={!hasNext} onClick={() => { setOffset(offset + PAGE_SIZE); }}>
                {copy.pagination.next}
              </Button>
            </div>
          </div>
        </>
      )}
    </PageLayout>
  );
}
