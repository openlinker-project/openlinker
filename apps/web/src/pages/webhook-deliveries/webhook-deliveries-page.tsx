import { useMemo, type ReactElement, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { describeApiError } from '../../shared/api/describe-api-error';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable } from '../../shared/ui/data-table';
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
import { webhookDlqCodeLabel } from '../../features/webhook-deliveries/lib/webhook-dlq-code-label';
import { createWebhookDeliveriesListRegistry } from '../../features/webhook-deliveries/lib/webhook-deliveries.list-config';
import {
  ColumnsPanel,
  EditedBar,
  RepairBanner,
  ViewDialogs,
  ViewsBar,
  useListView,
  type ViewSort,
} from '../../features/saved-views';
import { interpolate, useMessages } from '../../shared/i18n';

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

/**
 * Rows are one server page, sorted here: `GET /webhook-deliveries` takes no
 * sort, so a view's sort orders the page on screen, not the whole list.
 */
function sortDeliveries(rows: readonly WebhookDeliverySummary[], sort: ViewSort): WebhookDeliverySummary[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const value = (d: WebhookDeliverySummary): string =>
    sort.key === 'status' ? d.status : sort.key === 'provider' ? d.provider : d.receivedAt;
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    return x === y ? 0 : (x < y ? -1 : 1) * sign;
  });
}

export function WebhookDeliveriesPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const copy = useMessages('webhook-deliveries').webhookDeliveriesPage;
  const registry = useMemo(
    () =>
      createWebhookDeliveriesListRegistry(copy, {
        status: (d): ReactNode => (
          <StatusBadge tone={statusTone(d.status)}>{webhookDeliveryStatusLabel(d.status)}</StatusBadge>
        ),
        provider: (d): ReactNode => (
          <span className="mono-text" title={d.provider}>
            {d.provider}
          </span>
        ),
        eventType: (d): ReactNode => (
          <span className="mono-text" title={d.eventType ?? undefined}>
            {d.eventType ?? '—'}
          </span>
        ),
        connection: (d): ReactNode => (
          <ConnectionEntityLabel connectionId={d.connectionId} linkToDetail={false} showId />
        ),
        reason: (d): ReactNode => {
          const dlqLabel = d.rejectionReason ? null : webhookDlqCodeLabel(d.dlqCode);
          if (dlqLabel) return <span title={d.dlqReason ?? undefined}>{dlqLabel}</span>;
          const reason = d.rejectionReason ?? d.dlqReason;
          if (!reason) return <span className="text-muted">—</span>;
          return (
            <span className="mono-text" title={reason}>
              {reason.length > 60 ? `${reason.slice(0, 60)}…` : reason}
            </span>
          );
        },
        received: (d): ReactNode => <TimeDisplay iso={d.receivedAt} />,
      }),
    [copy],
  );
  const view = useListView<WebhookDeliverySummary>({ registry, pageTitle: copy.title });
  const columns = view.toColumns();

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

  const rows = useMemo(() => sortDeliveries(query.data?.items ?? [], view.sort), [query.data, view.sort]);
  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
    >
      <ViewsBar {...view.viewsBar} />

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
        <ColumnsPanel {...view.columnsPanel} />
      </div>

      {view.editedBar ? (
        <div className="sv-applied">
          <EditedBar {...view.editedBar} />
        </div>
      ) : null}
      {view.repairBanner ? <RepairBanner {...view.repairBanner} /> : null}
      <ViewDialogs {...view.dialogs} />

      {query.isLoading ? (
        <DataTableSkeleton columns={columns} />
      ) : query.error ? (
        <ErrorState
          title={copy.errorTitle}
          message={describeApiError(query.error, 'webhook-deliveries')}
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
            rows={rows}
            rowKey={(d) => d.id}
            rowHref={(d) => d.id}
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
