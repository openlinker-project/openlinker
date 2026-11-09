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
import { useMemo, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  interpolate,
  useFormat,
  useMessages,
  type Messages,
  type ResolvedCopy,
} from '../../shared/i18n';
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

type DispatchRiskCopy = ResolvedCopy<Messages['orders']>['dispatchRiskPage'];

const BUCKET_META = {
  overdue: { copyKey: 'overdue', tone: 'error' },
  at_risk: { copyKey: 'atRisk', tone: 'warning' },
  on_track: { copyKey: 'onTrack', tone: 'success' },
} as const satisfies Record<
  RiskBucket,
  { copyKey: keyof DispatchRiskCopy['buckets']; tone: 'error' | 'warning' | 'success' }
>;

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

function buildColumns(copy: DispatchRiskCopy): DataTableColumn<OrderRecord>[] {
  return [
    {
      id: 'internalOrderId',
      header: copy.columns.order,
      cell: (order) => <span className="mono">{order.internalOrderId}</span>,
    },
    {
      id: 'sourceConnectionId',
      header: copy.columns.source,
      hideBelow: 1024,
      cell: (order) => <ConnectionEntityLabel connectionId={order.sourceConnectionId} />,
    },
    {
      id: 'shipBy',
      header: copy.columns.shipBy,
      cell: (order) => {
        const due = order.dispatchByAt ?? null;
        // Live countdown only — the BUCKET itself is `order.slaState`, owned by
        // the backend. Re-deriving it here would create a second SLA vocabulary.
        const view = formatShipBy(due);
        const sla = slaBadge(order.slaState);
        // #2441 review S4 — an `<abbr>`, not a `<span aria-label>`. A `span` has no
        // ARIA role, so the label is not reliably exposed, and where it is it
        // REPLACES the visible "est." rather than expanding it. `<abbr title>` is
        // the element for exactly this and keeps the visible text intact.
        const estMark = order.dispatchByEstimated ? (
          <abbr className="text-muted" title={copy.estimate.title}>
            {copy.estimate.abbr}{' '}
          </abbr>
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
      header: copy.columns.fulfilment,
      hideBelow: 768,
      cell: (order) => {
        // No null guard: `fulfillmentBadge` is total by contract (#2678) — an
        // absent state means `not-shipped` and an unrecognised one renders a
        // neutral "Unknown (…)" badge. The guard that used to sit here was dead
        // and read as coverage it never provided (the #2589 dead-fallback lesson).
        const badge = fulfillmentBadge(order.fulfillmentState);
        return (
          <StatusBadge tone={badge.tone} compact>
            {badge.label}
          </StatusBadge>
        );
      },
    },
    {
      id: 'items',
      header: copy.columns.items,
      align: 'right',
      hideBelow: 480,
      cell: (order) => (
        <span className="mono tabular">{snapshotItemCount(order.orderSnapshot)}</span>
      ),
    },
  ];
}

export function DispatchRiskPage(): ReactElement {
  const copy = useMessages('orders').dispatchRiskPage;
  const format = useFormat();
  const columns = useMemo(() => buildColumns(copy), [copy]);
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
    { limit: PAGE_SIZE, offset }
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
  const bucketCopy = copy.buckets[BUCKET_META[bucket].copyKey];
  // Distinguish "nothing in THIS bucket" from "no order carries a deadline at
  // all" — the second is a configuration answer, not a clean queue.
  const noDeadlinesAnywhere =
    summary !== undefined && summary.overdue + summary.atRisk + summary.onTrack === 0;

  return (
    <PageLayout
      backTo={{ to: '/orders', label: copy.backToOrders }}
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
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
                // #2441 review S3 — no `aria-pressed` here: `Chip` already sets
                // it from `active`, and because it writes it BEFORE spreading
                // `...props`, a caller's copy overrides the primitive's. Passing
                // it re-opens a hole the primitive closed.
                onClick={() => {
                  selectBucket(candidate);
                }}
              >
                {copy.buckets[BUCKET_META[candidate].copyKey].label}
                {/* #2441 review S2 — bare-number form, matching the orders-list
                    invoicing and phase chips. Two adjacent Operations surfaces
                    were formatting one primitive two ways. */}
                {count === null ? null : ` ${format.number(count)}`}
              </Chip>
            );
          })}
        </div>
        <Select
          aria-label={copy.filterByConnection}
          value={connectionId ?? ''}
          onChange={(event) => {
            patchParams({ source: event.target.value || undefined, offset: undefined });
          }}
        >
          <option value="">{copy.allConnections}</option>
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.name}
            </option>
          ))}
        </Select>
      </div>

      {query.isLoading ? (
        <LoadingState liveRegion="off" title={copy.loading.title} message={copy.loading.message} />
      ) : query.error ? (
        <ErrorState
          title={copy.error.title}
          message={copy.error.message}
          action={
            <Button
              onClick={() => {
                void query.refetch();
              }}
            >
              {copy.error.retry}
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          liveRegion="off"
          title={noDeadlinesAnywhere ? copy.noDeadlines.title : bucketCopy.empty}
          message={noDeadlinesAnywhere ? copy.noDeadlines.message : copy.emptyBucket}
        />
      ) : (
        <DataTable
          caption={bucketCopy.caption}
          columns={columns}
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
            {interpolate(copy.pagination.showing, {
              from: format.number(offset + 1),
              to: format.number(Math.min(offset + PAGE_SIZE, total)),
              total: format.number(total),
            })}
          </span>
          <Button
            disabled={!hasPrev}
            onClick={() => {
              patchParams({ offset: String(Math.max(0, offset - PAGE_SIZE)) });
            }}
          >
            {copy.pagination.previous}
          </Button>
          <Button
            disabled={!hasNext}
            onClick={() => {
              patchParams({ offset: String(offset + PAGE_SIZE) });
            }}
          >
            {copy.pagination.next}
          </Button>
        </div>
      )}
    </PageLayout>
  );
}
