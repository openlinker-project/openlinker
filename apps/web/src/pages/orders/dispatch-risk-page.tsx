/**
 * Dispatch Risk Page
 *
 * Ranked ship-by triage surface (#2306): "what breaches first", with the SLA as
 * the PRIMARY axis rather than one column among ~8 filters on `/orders`. Rows
 * come from the existing list read pinned to `sort=dispatchBy&dir=asc` — the
 * ordering is entirely server-side, the page never re-sorts — and the bucket
 * counts from the existing `sla-summary` read under the IDENTICAL filter scope,
 * so tabs and rows agree by construction.
 *
 * Both reads pass `cancelled: false`. A cancelled order that never shipped
 * still satisfies the repository's `NOT_SHIPPED` guard, so without that scope
 * its past deadline reads as `overdue` — see `countBySla` (#2306). No SLA
 * vocabulary is re-derived here: the bucket is BE-owned (`slaState`), and the
 * only thing computed client-side is the live countdown phrase.
 *
 * `none` is deliberately not a tab — it means "no deadline, or already
 * shipped", which is the set this surface exists to exclude.
 *
 * @module apps/web/src/pages/orders
 */
import type { ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { Chip } from '../../shared/ui/chip';
import { Select } from '../../shared/ui/select';
import { StatusBadge } from '../../shared/ui/status-badge';
import { TimeDisplay } from '../../shared/ui/time-display';
import { useOrdersQuery } from '../../features/orders/hooks/use-orders-query';
import { useOrderSlaSummaryQuery } from '../../features/orders/hooks/use-order-sla-summary-query';
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import { ConnectionEntityLabel } from '../../features/connections/components/ConnectionEntityLabel';
import { formatShipBy, type ShipByLevel } from '../../shared/format/format-ship-by';
import { fulfillmentBadge, slaBadge } from '../../features/orders/lib/order-health';
import type { OrderRecord, SlaStateValue } from '../../features/orders/api/orders.types';

const PAGE_SIZE = 25;

/**
 * The three actionable buckets, most urgent first. `none` is excluded by
 * design — it carries no deadline to rank against.
 */
type RiskBucket = Exclude<SlaStateValue, 'none'>;

const RISK_BUCKETS: readonly RiskBucket[] = ['overdue', 'at_risk', 'on_track'];

const BUCKET_META: Record<RiskBucket, { label: string; tone: 'error' | 'warning' | 'success' }> = {
  overdue: { label: 'Overdue', tone: 'error' },
  at_risk: { label: 'Due soon', tone: 'warning' },
  on_track: { label: 'On track', tone: 'success' },
};

const SHIP_BY_TONE: Record<ShipByLevel, 'error' | 'warning' | 'success'> = {
  overdue: 'error',
  soon: 'warning',
  ok: 'success',
};

function isRiskBucket(value: string | null): value is RiskBucket {
  return value !== null && (RISK_BUCKETS as readonly string[]).includes(value);
}

function snapshotItemCount(snapshot: Record<string, unknown>): number {
  const items = snapshot['items'];
  if (Array.isArray(items)) return items.length;
  return 0;
}

const COLUMNS: DataTableColumn<OrderRecord>[] = [
  {
    id: 'internalOrderId',
    header: 'Order',
    cell: (order) => <span className="mono">{order.internalOrderId}</span>,
  },
  {
    id: 'sourceConnectionId',
    header: 'Source',
    hideBelow: 1024,
    cell: (order) => <ConnectionEntityLabel connectionId={order.sourceConnectionId} />,
  },
  {
    id: 'shipBy',
    header: 'Ship by',
    cell: (order) => {
      const due = order.dispatchByAt ?? null;
      // Live countdown only — the BUCKET itself is `order.slaState`, owned by
      // the backend. Re-deriving it here would create a second SLA vocabulary.
      const view = formatShipBy(due);
      const sla = slaBadge(order.slaState);
      const estMark = order.dispatchByEstimated ? (
        <span
          className="text-muted"
          aria-label="Estimated"
          title="OpenLinker estimate - not a marketplace-confirmed deadline"
        >
          est.{' '}
        </span>
      ) : null;

      return (
        <span className="ds-row" style={{ alignItems: 'center', gap: 'var(--space-2)' }}>
          {sla ? (
            <StatusBadge tone={sla.tone} withDot compact>
              {sla.label}
            </StatusBadge>
          ) : null}
          {view ? (
            <span className="text-muted mono tabular">
              {estMark}
              {view.remaining}
            </span>
          ) : null}
          {due ? <TimeDisplay iso={due} /> : null}
        </span>
      );
    },
  },
  {
    id: 'fulfillmentState',
    header: 'Fulfillment',
    hideBelow: 768,
    cell: (order) => {
      const badge = fulfillmentBadge(order.fulfillmentState);
      if (!badge) return null;
      return (
        <StatusBadge tone={badge.tone} compact>
          {badge.label}
        </StatusBadge>
      );
    },
  },
  {
    id: 'items',
    header: 'Items',
    align: 'right',
    hideBelow: 480,
    cell: (order) => <span className="mono tabular">{snapshotItemCount(order.orderSnapshot)}</span>,
  },
];

export function DispatchRiskPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();

  const bucketParam = searchParams.get('bucket');
  const bucket: RiskBucket = isRiskBucket(bucketParam) ? bucketParam : 'overdue';
  const connectionId = searchParams.get('source') ?? undefined;
  const offsetParam = Number(searchParams.get('offset') ?? '0');
  const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0;

  // ONE scope object, shared by both reads, so a divergence is not expressible.
  const scope = { sourceConnectionId: connectionId, cancelled: false } as const;

  const summaryQuery = useOrderSlaSummaryQuery(scope);
  const query = useOrdersQuery(
    { ...scope, slaState: bucket, sort: 'dispatchBy', dir: 'asc' },
    { limit: PAGE_SIZE, offset },
  );

  const connectionsQuery = useConnectionsQuery();
  const connections = connectionsQuery.data ?? [];

  const summary = summaryQuery.data;
  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  function patchParams(patch: Record<string, string | undefined>): void {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next);
  }

  function selectBucket(nextBucket: RiskBucket): void {
    // A bucket change resets paging — offset 3 of "overdue" is meaningless in
    // "on track".
    patchParams({ bucket: nextBucket, offset: undefined });
  }

  function bucketCount(candidate: RiskBucket): number | null {
    if (!summary) return null;
    if (candidate === 'overdue') return summary.overdue;
    if (candidate === 'at_risk') return summary.atRisk;
    return summary.onTrack;
  }

  const rows = query.data?.items ?? [];
  const meta = BUCKET_META[bucket];
  // Distinguish "nothing in THIS bucket" from "no order carries a deadline at
  // all" — the second is a configuration answer, not a clean queue.
  const noDeadlinesAnywhere =
    summary !== undefined && summary.overdue + summary.atRisk + summary.onTrack === 0;

  return (
    <PageLayout
      backTo={{ to: '/orders', label: 'Orders' }}
      eyebrow="Operations"
      title="Dispatch risk"
      description="Orders ranked by how soon they breach their ship-by deadline. Dispatched, delivered and cancelled orders are excluded."
    >
      <div className="toolbar">
        <div className="ds-row" style={{ alignItems: 'center', gap: 'var(--space-2)' }}>
          {RISK_BUCKETS.map((candidate) => {
            const count = bucketCount(candidate);
            return (
              <Chip
                key={candidate}
                tone={BUCKET_META[candidate].tone}
                active={candidate === bucket}
                aria-pressed={candidate === bucket}
                onClick={() => {
                  selectBucket(candidate);
                }}
              >
                {BUCKET_META[candidate].label}
                {count === null ? '' : ` (${count})`}
              </Chip>
            );
          })}
        </div>
        <Select
          aria-label="Filter by connection"
          value={connectionId ?? ''}
          onChange={(event) => {
            patchParams({ source: event.target.value || undefined, offset: undefined });
          }}
        >
          <option value="">All connections</option>
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.name}
            </option>
          ))}
        </Select>
      </div>

      {query.isLoading ? (
        <LoadingState
          liveRegion="off"
          title="Loading dispatch risk"
          message="Fetching orders ranked by ship-by deadline."
        />
      ) : query.error ? (
        <ErrorState
          title="Could not load dispatch risk"
          message="The order list could not be fetched."
          action={
            <Button
              onClick={() => {
                void query.refetch();
              }}
            >
              Retry
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          liveRegion="off"
          title={noDeadlinesAnywhere ? 'No ship-by deadlines' : `Nothing ${meta.label.toLowerCase()}`}
          message={
            noDeadlinesAnywhere
              ? 'No open order carries a ship-by deadline, so there is nothing to rank. Deadlines come from the marketplace dispatch window.'
              : 'No open order sits in this bucket right now.'
          }
        />
      ) : (
        <DataTable
          caption={`Orders ${meta.label.toLowerCase()}, soonest deadline first`}
          columns={COLUMNS}
          rows={rows}
          rowKey={(order) => order.internalOrderId}
          rowHref={(order) => `/orders/${order.internalOrderId}`}
          cardView={{
            title: (order) => <span className="mono">{order.internalOrderId}</span>,
            subtitle: (order) => {
              const view = formatShipBy(order.dispatchByAt ?? null);
              if (!view) return null;
              return (
                <StatusBadge tone={SHIP_BY_TONE[view.level]} withDot compact>
                  {view.remaining}
                </StatusBadge>
              );
            },
          }}
        />
      )}

      {rows.length > 0 && (
        <div className="pagination">
          <span className="text-muted">
            Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <Button
            disabled={!hasPrev}
            onClick={() => {
              patchParams({ offset: String(Math.max(0, offset - PAGE_SIZE)) });
            }}
          >
            Previous
          </Button>
          <Button
            disabled={!hasNext}
            onClick={() => {
              patchParams({ offset: String(offset + PAGE_SIZE) });
            }}
          >
            Next
          </Button>
        </div>
      )}
    </PageLayout>
  );
}
