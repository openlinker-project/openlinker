import type { ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { useTableSort } from '../../shared/ui/use-table-sort';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Button } from '../../shared/ui/button';
import { Select } from '../../shared/ui/select';
import { Input } from '../../shared/ui/input';
import { TimeDisplay } from '../../shared/ui/time-display';
import { EntityLabel } from '../../shared/ui/entity-label';
import { ShipmentStatusBadge } from '../../features/shipments/components/shipment-status-badge';
import { useShipmentsQuery } from '../../features/shipments/hooks/use-shipments-query';
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import { CustomerEntityLabel } from '../../features/customers/components/CustomerEntityLabel';
import { ConnectionEntityLabel } from '../../features/connections/components/ConnectionEntityLabel';
import type { Shipment, ShipmentFilters, ShipmentStatus, ShippingMethod } from '../../features/shipments/api/shipments.types';
import {
  SHIPMENT_STATUS_VALUES,
  SHIPPING_METHOD_VALUES,
  SHIPMENTS_PAGE_SIZE,
} from '../../features/shipments/api/shipments.types';

const PAGE_SIZE = SHIPMENTS_PAGE_SIZE;

/** Capability a connection must declare for shipping-method-specific columns to
 * render (the #727 spec's `paczkomat-shipment` / `kurier-domestic-shipment` map
 * to this single capability on the connection). */
const SHIPPING_CAPABILITY = 'ShippingProviderManager';

function parseHasTracking(raw: string | null): boolean | undefined {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

/**
 * The date input yields a bare `YYYY-MM-DD`, which the backend resolves to
 * 00:00:00Z — so a `createdTo` of `2026-05-01` would exclude everything created
 * later that day. Extend a date-only upper bound to end-of-day (UTC) so a
 * single-day range is inclusive. `createdFrom` stays at 00:00:00Z (start of day).
 * Both bounds are UTC-anchored; a fully timezone-aware range is a deferred
 * enhancement (off by the operator's tz offset at the day edges).
 */
function inclusiveEndOfDay(dateOnly: string): string {
  return dateOnly.includes('T') ? dateOnly : `${dateOnly}T23:59:59.999Z`;
}

export function ShipmentsPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sort, setSort } = useTableSort([{ id: 'createdAt', desc: true }]);

  const status = (searchParams.get('status') as ShipmentStatus | null) ?? undefined;
  const shippingMethod = (searchParams.get('shippingMethod') as ShippingMethod | null) ?? undefined;
  const connectionId = searchParams.get('connectionId') ?? undefined;
  const hasTracking = parseHasTracking(searchParams.get('hasTracking'));
  const createdFrom = searchParams.get('createdFrom') ?? undefined;
  const createdTo = searchParams.get('createdTo') ?? undefined;
  const offset = Number(searchParams.get('offset') ?? '0');

  const filters: ShipmentFilters = {
    status,
    shippingMethod,
    connectionId,
    hasTracking,
    createdFrom,
    createdTo: createdTo ? inclusiveEndOfDay(createdTo) : undefined,
  };
  const pagination = { limit: PAGE_SIZE, offset };

  const query = useShipmentsQuery(filters, pagination);
  const connectionsQuery = useConnectionsQuery();
  const connections = connectionsQuery.data ?? [];

  // Capability-conditional rendering (#727 AC): hide shipping-method-specific
  // columns when no connection declares the shipping capability.
  const showMethodColumns = connections.some((c) =>
    c.supportedCapabilities.includes(SHIPPING_CAPABILITY),
  );

  function setFilter(key: string, value: string): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      next.delete('offset'); // reset pagination on filter change
      return next;
    });
  }

  function setOffset(next: number): void {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === 0) {
        p.delete('offset');
      } else {
        p.set('offset', String(next));
      }
      return p;
    });
  }

  function clearFilters(): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const key of ['status', 'shippingMethod', 'connectionId', 'hasTracking', 'createdFrom', 'createdTo', 'offset']) {
        next.delete(key);
      }
      return next;
    });
  }

  const filtersActive = Boolean(
    status || shippingMethod || connectionId || hasTracking !== undefined || createdFrom || createdTo,
  );
  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  // Shipping-method-specific columns, gated on capability (#727 AC). Typed as
  // DataTableColumn<Shipment>[] so the `hideBelow` literals narrow correctly.
  const methodColumns: DataTableColumn<Shipment>[] = showMethodColumns
    ? [
        {
          id: 'shippingMethod',
          header: 'Method',
          cell: (s) => <span className="mono-text">{s.shippingMethod}</span>,
          accessor: (s) => s.shippingMethod,
          sortable: true,
        },
        {
          id: 'paczkomatId',
          header: 'Paczkomat',
          cell: (s) =>
            s.paczkomatId ? (
              <span className="mono-text">{s.paczkomatId}</span>
            ) : (
              <span className="text-muted">—</span>
            ),
          hideBelow: 1024,
        },
      ]
    : [];

  const columns: DataTableColumn<Shipment>[] = [
    {
      id: 'status',
      header: 'Status',
      cell: (s) => <ShipmentStatusBadge status={s.status} />,
      accessor: (s) => s.status,
      sortable: true,
    },
    {
      id: 'createdAt',
      header: 'Created',
      cell: (s) => <TimeDisplay iso={s.createdAt} />,
      accessor: (s) => s.createdAt,
      sortable: true,
    },
    {
      id: 'orderId',
      header: 'Order',
      cell: (s) => <EntityLabel id={s.orderId} to={`/orders/${s.orderId}`} showId />,
    },
    {
      id: 'customerId',
      header: 'Customer',
      cell: (s) =>
        s.customerId ? (
          <CustomerEntityLabel customerId={s.customerId} showId={false} />
        ) : (
          <span className="text-muted">—</span>
        ),
      hideBelow: 768,
    },
    ...methodColumns,
    {
      id: 'connectionId',
      header: 'Connection',
      cell: (s) => <ConnectionEntityLabel connectionId={s.connectionId} linkToDetail={false} showId={false} />,
      hideBelow: 1024,
    },
    {
      id: 'trackingNumber',
      header: 'Tracking',
      cell: (s) =>
        s.trackingNumber ? (
          <span className="mono-text">{s.trackingNumber}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
      hideBelow: 768,
    },
  ];

  return (
    <PageLayout
      eyebrow="Operations"
      title="Shipments"
      description="Cross-order rollup of every shipment — filter by status, method, connection, or date."
    >
      <div className="toolbar">
        <Select
          aria-label="Filter by status"
          value={status ?? ''}
          onChange={(e) => { setFilter('status', e.target.value); }}
        >
          <option value="">All statuses</option>
          {SHIPMENT_STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>

        {showMethodColumns ? (
          <Select
            aria-label="Filter by shipping method"
            value={shippingMethod ?? ''}
            onChange={(e) => { setFilter('shippingMethod', e.target.value); }}
          >
            <option value="">All methods</option>
            {SHIPPING_METHOD_VALUES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        ) : null}

        <Select
          aria-label="Filter by tracking"
          value={hasTracking === undefined ? '' : String(hasTracking)}
          onChange={(e) => { setFilter('hasTracking', e.target.value); }}
        >
          <option value="">Any tracking</option>
          <option value="true">With tracking</option>
          <option value="false">Without tracking</option>
        </Select>

        <Select
          aria-label="Filter by connection"
          value={connectionId ?? ''}
          onChange={(e) => { setFilter('connectionId', e.target.value); }}
        >
          <option value="">All connections</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>

        <Input
          type="date"
          aria-label="Created from"
          value={createdFrom ?? ''}
          onChange={(e) => { setFilter('createdFrom', e.target.value); }}
        />
        <Input
          type="date"
          aria-label="Created to"
          value={createdTo ?? ''}
          onChange={(e) => { setFilter('createdTo', e.target.value); }}
        />
      </div>

      {query.isLoading ? (
        <DataTableSkeleton columns={columns} />
      ) : query.error ? (
        <ErrorState
          title="Unable to load shipments"
          message={query.error.message}
          action={<Button onClick={() => { void query.refetch(); }}>Retry</Button>}
        />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          liveRegion="off"
          title="No shipments found"
          message={
            filtersActive
              ? 'No shipments match the current filters.'
              : 'No shipments have been created yet.'
          }
          action={filtersActive ? <Button onClick={clearFilters}>Clear filters</Button> : undefined}
        />
      ) : (
        <>
          <DataTable
            caption="Shipments"
            columns={columns}
            rows={query.data?.items ?? []}
            rowKey={(s) => s.id}
            rowHref={(s) => `/orders/${s.orderId}`}
            sort={sort}
            onSortChange={setSort}
            cardView={{
              title: (s) => s.status,
              subtitle: (s) =>
                s.customerId ? (
                  <CustomerEntityLabel customerId={s.customerId} showId={false} />
                ) : (
                  <EntityLabel id={s.orderId} to={`/orders/${s.orderId}`} showId />
                ),
              meta: (s) => <ShipmentStatusBadge status={s.status} />,
            }}
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
