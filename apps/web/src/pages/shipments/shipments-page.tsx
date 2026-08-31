/**
 * Shipments Page
 *
 * Cross-order shipment rollup: filters, cause-first triage strips, and a
 * per-row accordion carrying the recovery actions (#727 / #839 / #1826).
 *
 * Permission note (#1826, deliberate): both flags here come from
 * `usePermission`, NOT `useWriteAccess` (#1615), so this flow's write
 * affordances are absent — not disabled-with-tooltip — for a public-demo
 * read-only viewer. §7 of
 * `docs/plans/implementation-plan-shipments-inline-retry.md` chose that
 * deliberately, because the carrier `errorMessage` these affordances sit
 * beside is itself role-redacted server-side. Do not "fix" this by swapping in
 * `useWriteAccess` without revisiting that decision.
 *
 * @module apps/web/src/pages/shipments
 */
import { useMemo, type ReactElement } from 'react';
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
import { usePermission } from '../../shared/auth/use-permission';
import { ShipmentStatusBadge } from '../../features/shipments/components/shipment-status-badge';
import { ProcessorBadge } from '../../features/shipments/components/processor-badge';
import { ShipmentTriageStrip } from '../../features/shipments/components/shipment-triage-strip';
import { ShipmentRowDetail } from '../../features/shipments/components/shipment-row-detail';
import { groupFailedShipmentsByCause } from '../../features/shipments/lib/group-failed-shipments-by-cause';
import { useShipmentsQuery } from '../../features/shipments/hooks/use-shipments-query';
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import { ConnectionCell, ConnectionFold } from '../../features/connections';
import { CustomerEntityLabel } from '../../features/customers/components/CustomerEntityLabel';
import { ConnectionDot, OrderIdentityCell } from '../../features/orders';
// Pure view-model helpers + the wire-mirrored redaction constant live in the
// owning feature (they're unit-tested there); the page only composes them.
import { REDACTED_ERROR_MESSAGE, ShipmentSeverityLabel } from '../../features/shipments';
import type { Shipment, ShipmentFilters, ShipmentStatus, ShippingMethod } from '../../features/shipments/api/shipments.types';
import {
  SHIPMENT_STATUS_VALUES,
  SHIPPING_METHOD_VALUES,
  SHIPPING_METHOD_LABEL,
  SHIPMENTS_PAGE_SIZE,
} from '../../features/shipments/api/shipments.types';
import {
  PROCESSOR_FILTER_VALUES,
  PROCESSOR_KIND_LABEL,
  deriveProcessor,
  parseProcessorFilter,
  toShipmentProcessorFilters,
} from '../../features/shipments/lib/processor';

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

/**
 * Cap on rendered triage strips (#1905). Each strip is a `role="status"` live
 * region; one per qualifying group on a 20-row page could push the table below
 * the fold and announce a wall of text. The remainder collapses to a one-line
 * count.
 */
const MAX_TRIAGE_STRIPS = 2;

/**
 * Status cell (#1800). The status badge, plus — for a `failed` shipment that
 * persisted a rejection — a compact one-line `errorMessage` (full text on
 * hover) and the `failedAt` time, so an operator scanning the list sees which
 * shipments failed and why without opening each order. Non-failed rows render
 * the badge alone.
 *
 * Viewer-role redaction (#1826): the raw carrier `errorMessage` may embed
 * address fragments (a rejected postcode/street), so a `viewer` session sees
 * a generic placeholder instead — same copy as `<ShipmentRowDetail>`'s
 * redacted state, both title and text, so there's no unredacted tooltip leak.
 * This is UI-decluttering on top of a REAL server-side redaction
 * (`ShipmentResponseDto.fromDomain`'s `canWrite` param, gated on the
 * requester's `shipments:write` permission) — the API itself never returns
 * the raw message to a viewer session, so this isn't the only enforcement
 * boundary.
 */
function ShipmentStatusCell({ shipment, canWrite }: { shipment: Shipment; canWrite: boolean }): ReactElement {
  const showError = shipment.status === 'failed' && Boolean(shipment.errorMessage);
  const errorText = canWrite ? shipment.errorMessage : REDACTED_ERROR_MESSAGE;
  return (
    <div className="shipment-status-cell">
      <ShipmentStatusBadge status={shipment.status} />
      {showError ? (
        <span className="shipment-status-cell__error">
          <span className="shipment-status-cell__error-message" title={canWrite ? (shipment.errorMessage ?? undefined) : undefined}>
            {errorText}
          </span>
          {shipment.failedAt ? (
            <span className="shipment-status-cell__error-time">
              <TimeDisplay iso={shipment.failedAt} />
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

export function ShipmentsPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sort, setSort } = useTableSort([{ id: 'createdAt', desc: true }]);
  // Gates the triage strip, the recovery actions in the row accordion, and the
  // raw errorMessage text in the status cell (#1826) — a `viewer` session sees
  // a generic redaction instead of the carrier's raw (possibly address-bearing)
  // rejection message.
  const canWrite = usePermission('shipments:write');
  // Distinct from `canWrite` on purpose: the triage strip's "Review connection
  // settings" CTA edits a CONNECTION, so it follows `connections:write`. An
  // operator who may retry shipments is not automatically allowed to reconfigure
  // the carrier account.
  const canReviewConnection = usePermission('connections:write');

  const status = (searchParams.get('status') as ShipmentStatus | null) ?? undefined;
  const shippingMethod = (searchParams.get('shippingMethod') as ShippingMethod | null) ?? undefined;
  const connectionId = searchParams.get('connectionId') ?? undefined;
  const hasTracking = parseHasTracking(searchParams.get('hasTracking'));
  // Processor filter (#839) is independent URL state — when present it
  // overrides the shippingMethod / hasProviderShipmentId slice via
  // `toShipmentProcessorFilters` below. The two URL params are mutually
  // exclusive at the toolbar level (the Method dropdown is hidden when a
  // processor filter is set) so users can't put the BE filters in a
  // contradictory state.
  const processor = parseProcessorFilter(searchParams.get('processor'));
  const createdFrom = searchParams.get('createdFrom') ?? undefined;
  const createdTo = searchParams.get('createdTo') ?? undefined;
  const offset = Number(searchParams.get('offset') ?? '0');

  const filters: ShipmentFilters = {
    status,
    connectionId,
    hasTracking,
    createdFrom,
    createdTo: createdTo ? inclusiveEndOfDay(createdTo) : undefined,
    // Spread the processor filter LAST so it overrides any raw `shippingMethod`
    // URL state when both are present — a defence against stale links where
    // a previous toolbar layout left both params on the URL.
    ...(processor === undefined ? { shippingMethod } : toShipmentProcessorFilters(processor)),
  };
  const pagination = { limit: PAGE_SIZE, offset };

  const query = useShipmentsQuery(filters, pagination);
  const connectionsQuery = useConnectionsQuery();
  const connections = connectionsQuery.data ?? [];
  // One batched read, indexed once — `ConnectionCell` must never fetch per row
  // (#1996). `.get()` returns `undefined` on a miss, which the cell reads as
  // "resolve it yourself", so every lookup coalesces to `null`.
  const connectionsById = useMemo(
    () => new Map(connections.map((c) => [c.id, c])),
    [connections],
  );

  // ONE renderer for the desktop Order column and the mobile card title. The
  // two used to be separate hand-rolled `EntityLabel`s that nothing kept in
  // sync — the specific drift the shared cell exists to kill (#2089), so this is
  // a function, not two call sites that happen to match today.
  const renderOrderCell = (s: Shipment): ReactElement => (
    <OrderIdentityCell
      orderId={s.orderId}
      orderNumber={s.orderSummary?.orderNumber}
      firstItemName={s.orderSummary?.firstItemName}
      firstItemImageUrl={s.orderSummary?.firstItemImageUrl}
      itemCount={s.orderSummary?.itemCount}
    />
  );
  const failedCauseGroups = useMemo(
    () => groupFailedShipmentsByCause(query.data?.items ?? []),
    [query.data],
  );

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
      for (const key of [
        'status',
        'shippingMethod',
        'processor',
        'connectionId',
        'hasTracking',
        'createdFrom',
        'createdTo',
        'offset',
      ]) {
        next.delete(key);
      }
      return next;
    });
  }

  const filtersActive = Boolean(
    status ||
      shippingMethod ||
      processor ||
      connectionId ||
      hasTracking !== undefined ||
      createdFrom ||
      createdTo,
  );
  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  // Shipping-method-specific columns, gated on capability (#727 AC). Typed as
  // DataTableColumn<Shipment>[] so the `hideBelow` literals narrow correctly.
  // Method renders the operator-readable label (`SHIPPING_METHOD_LABEL`) so
  // branch-1 rows show "OMP-fulfilled" instead of the raw `'omp'` enum
  // value the BE stores (#839).
  const methodColumns: DataTableColumn<Shipment>[] = showMethodColumns
    ? [
        {
          id: 'shippingMethod',
          header: 'Method',
          cell: (s) => <span className="mono-text">{SHIPPING_METHOD_LABEL[s.shippingMethod]}</span>,
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
      cell: (s) => <ShipmentStatusCell shipment={s} canWrite={canWrite} />,
      accessor: (s) => s.status,
      sortable: true,
    },
    {
      id: 'orderId',
      // #2538 - OrderIdentityCell stacks the order number over a meta line.
      lines: 2,
      header: 'Order',
      // Position 2 so the frozen pane is Status + row IDENTITY (#1905),
      // matching `/orders` (select + order). Frozen on Status alone, a
      // horizontally-scrolled row read "failed - sender postcode invalid" with
      // no way to tell which order it belonged to.
      //
      // `OrderIdentityCell` (#2087) replaced a hand-rolled `EntityLabel` that
      // showed a truncated id and nothing else — no thumbnail, no item name, no
      // `+N`. The data has been on the response since #1995 / PR #2012 and was
      // typed-but-unconsumed until now.
      cell: renderOrderCell,
    },
    {
      id: 'action',
      header: 'Action',
      // Plain text, not sortable — it's a derived hint riding alongside the
      // real control (the row's `expandable` toggle), not a second
      // interactive column.
      cell: (s) => <ShipmentSeverityLabel shipment={s} canWrite={canWrite} />,
    },
    {
      id: 'processor',
      header: 'Processor',
      // FE-derived from (shippingMethod, providerShipmentId) — see
      // `features/shipments/lib/processor.ts`. Branch-2 vs. branch-3
      // disambiguation needs the order's source platformType and is deferred
      // per #839 plan §5; this column is the two-bucket v1.
      //
      // Not sortable — alphabetical sort over ('carrier' / 'omp' / 'pending')
      // isn't a meaningful operator axis. If a sort comparator becomes
      // useful (e.g. branch-priority), set `sortable: true` and define an
      // explicit comparator at that point. Consistent with the existing
      // Connection / Tracking columns (also non-sortable).
      // The Connection column is `hideBelow: 1024`, so below that width the
      // carrier connection would simply vanish. It folds here instead (#2094):
      // "Processor" and "which carrier connection" are one question, and the
      // fold is `display: none` above the breakpoint so exactly one of the two
      // renderings is ever exposed — including to a screen reader.
      cell: (s): ReactElement => {
        const connection = connectionsById.get(s.connectionId) ?? null;
        return (
          <span className="shipments-processor-cell">
            <ProcessorBadge processor={deriveProcessor(s)} />
            <ConnectionFold
              connectionId={s.connectionId}
              connection={connection}
              loading={connectionsQuery.isLoading}
              adornment={
                <span aria-hidden="true">
                  <ConnectionDot
                    name={connection?.name ?? null}
                    platformType={connection?.platformType}
                    variant={s.shippingMethod === 'omp' ? 'shop' : 'carrier'}
                  />
                </span>
              }
            />
          </span>
        );
      },
    },
    {
      id: 'createdAt',
      header: 'Created',
      cell: (s) => <TimeDisplay iso={s.createdAt} />,
      accessor: (s) => s.createdAt,
      sortable: true,
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
      // The shared `ConnectionCell` (#2027) composes `ConnectionEntityLabel` and
      // takes this column's long-standing `ConnectionDot` as its adornment (#2089).
      // For a carrier-dispatched shipment `connectionId` is the shipping-provider
      // connection; for an `omp`/branch-1 row it's the destination SHOP
      // connection instead (there is no OL dispatch, so no separate carrier
      // connection exists — `createBranchOneShipment` stamps the shop's own id
      // there). `variant` follows the same split so the dot's generic-glyph
      // fallback reads "S"/shop-toned instead of "?"/carrier-toned for an
      // unresolved omp connection.
      //
      // Header stays "Connection" (#1905): a brief rename to "Provider" broke
      // the vocabulary six other tables use for this same column — and this
      // page's own filter still says "All connections", so an operator hunting
      // for a "Provider" filter would never find it.
      id: 'connectionId',
      header: 'Connection',
      cell: (s): ReactElement => {
        const connection = connectionsById.get(s.connectionId) ?? null;
        return (
          <ConnectionCell
            connectionId={s.connectionId}
            connection={connection}
            loading={connectionsQuery.isLoading}
            // The glyph this column already showed, kept as the shared cell's
            // adornment rather than bolted on as a second cell shape.
            // `aria-hidden` — `ConnectionCell`'s own name link carries the
            // accessible name; `ConnectionDot` would otherwise announce it a
            // second time via its `sr-only` span + `title`.
            adornment={
              <span aria-hidden="true">
                <ConnectionDot
                  name={connection?.name ?? null}
                  platformType={connection?.platformType}
                  variant={s.shippingMethod === 'omp' ? 'shop' : 'carrier'}
                />
              </span>
            }
          />
        );
      },
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

        {/* Processor filter (#839 AC-7) — the cross-branch dimension. v1
            exposes the two confidently-filterable buckets ('omp' /
            'carrier'); pending is derived but not filterable. Mutually
            exclusive with the Method dropdown below — when Processor is
            set, the Method dropdown is hidden so the BE filter slice can't
            contradict itself (the Processor selector implies a method
            slice; the user picks one OR the other, not both). */}
        <Select
          aria-label="Filter by processor"
          value={processor ?? ''}
          onChange={(e) => {
            // Batch the processor + shippingMethod + offset reset in one
            // setSearchParams transaction so the URL never enters an
            // intermediate state (processor set but stale shippingMethod
            // still present). Tech-review SUGGESTION fix.
            const value = e.target.value;
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              if (value) {
                next.set('processor', value);
                // Deep-links could carry both params; clear the method when
                // Processor takes over.
                next.delete('shippingMethod');
              } else {
                next.delete('processor');
              }
              next.delete('offset');
              return next;
            });
          }}
        >
          <option value="">All processors</option>
          {PROCESSOR_FILTER_VALUES.map((p) => (
            <option key={p} value={p}>
              {PROCESSOR_KIND_LABEL[p]}
            </option>
          ))}
        </Select>

        {showMethodColumns && processor === undefined ? (
          <Select
            aria-label="Filter by shipping method"
            value={shippingMethod ?? ''}
            onChange={(e) => { setFilter('shippingMethod', e.target.value); }}
          >
            <option value="">All methods</option>
            {SHIPPING_METHOD_VALUES.map((m) => (
              <option key={m} value={m}>
                {SHIPPING_METHOD_LABEL[m]}
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
        <DataTableSkeleton columns={columns} rowAction label="Loading shipments…" />
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
          {/* Cause-first triage (#1826): admin/operator only — the strip's
              recovery jump is a write action and its cause text is the same
              sensitive carrier content redacted in the status cell / row
              accordion for viewer, so it's hidden entirely rather than shown
              redacted. Grouped over the current page only (no cross-page
              aggregation). */}
          {canWrite ? (
            <>
              {failedCauseGroups.slice(0, MAX_TRIAGE_STRIPS).map((group) => (
                <ShipmentTriageStrip
                  key={`${group.connectionId}::${group.cause}`}
                  group={group}
                  connectionName={
                    connectionsById.get(group.connectionId)?.name ?? null
                  }
                  canReviewConnection={canReviewConnection}
                />
              ))}
              {failedCauseGroups.length > MAX_TRIAGE_STRIPS ? (
                <p className="text-muted shipments-page__triage-overflow">
                  +{failedCauseGroups.length - MAX_TRIAGE_STRIPS} more group
                  {failedCauseGroups.length - MAX_TRIAGE_STRIPS === 1 ? '' : 's'} with a shared
                  carrier message.
                </p>
              ) : null}
            </>
          ) : null}

          <DataTable
            caption="Shipments"
            columns={columns}
            rows={query.data?.items ?? []}
            rowKey={(s) => s.id}
            sort={sort}
            onSortChange={setSort}
            // Opts this table into the 11rem frozen-pane cap for
            // `.order-cell__body` (#2089, re-scoped by #2091). The budget was
            // measured against THIS page's frozen cluster — Status carrying a
            // 32ch error string beside Order — so it is opted into per page
            // rather than applying to whichever table freezes a column next.
            className="shipments-table"
            // Frozen anchor = Status + Order (#1905) — mirrors /orders, which
            // freezes select + order, i.e. the row's identity. The auto
            // expander column is frozen alongside them.
            stickyLeftColumns={2}
            expandable={{
              renderDetail: (s) => (
                <ShipmentRowDetail
                  shipment={s}
                  canWrite={canWrite}
                  canReviewConnection={canReviewConnection}
                />
              ),
              toggleLabel: (s, expanded) =>
                expanded ? `Collapse details for shipment ${s.id}` : `Expand details for shipment ${s.id}`,
            }}
            cardView={{
              // Order link restored (#1826) — dropping `rowHref` in favour of
              // the expandable toggle removed the mobile card's only path to
              // the order (it previously fell back to the order EntityLabel
              // only when `customerId` was absent). Now unconditional, same
              // as the desktop Order column.
              title: renderOrderCell,
              subtitle: (s) =>
                s.customerId ? <CustomerEntityLabel customerId={s.customerId} showId={false} /> : null,
              meta: (s) => <ShipmentStatusCell shipment={s} canWrite={canWrite} />,
              // Severity label in `summary` (#1826 AC) — mirrors the desktop
              // Action column, shown before the collapsible full detail.
              summary: (s) => <ShipmentSeverityLabel shipment={s} canWrite={canWrite} />,
              collapsibleDetail: true,
              detail: (s) => (
                <ShipmentRowDetail
                  shipment={s}
                  canWrite={canWrite}
                  canReviewConnection={canReviewConnection}
                />
              ),
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
