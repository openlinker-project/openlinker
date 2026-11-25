/**
 * Shipments Page
 *
 * Cross-order shipment rollup on the orders list system (#4044): status tabs
 * and "Needs a look" with counts from the summary endpoint (#4043), one
 * joined Processor / Method / Connection / Filters group, applied pills, a
 * Sort menu, fixed column widths, and a peek (side panel, bottom sheet on
 * phones) carrying the recovery actions the expanded row used to hold
 * (#727 / #839 / #1826). Cause-first triage strips show on the Failed tab.
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
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { interpolate, useFormat, useMessages, usePlural } from '../../shared/i18n';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Button } from '../../shared/ui/button';
import { PeekArrow } from '../../shared/ui/capped-badges';
import { shortenId } from '../../shared/ui/entity-label';
import { TimeDisplay } from '../../shared/ui/time-display';
import { usePermission } from '../../shared/auth/use-permission';
import { ShipmentStatusBadge } from '../../features/shipments/components/shipment-status-badge';
import { WaybillRelayStuckBadge } from '../../features/shipments/components/waybill-relay-stuck-badge';
import { ProcessorBadge } from '../../features/shipments/components/processor-badge';
import { ShipmentTriageStrip } from '../../features/shipments/components/shipment-triage-strip';
import { ShipmentRowDetail } from '../../features/shipments/components/shipment-row-detail';
import { ShipmentAttentionSummary } from '../../features/shipments/components/shipment-attention-summary';
import { useShipmentsSummaryQuery } from '../../features/shipments/hooks/use-shipments-summary-query';
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
  deriveProcessor,
  parseProcessorFilter,
  toShipmentProcessorFilters,
} from '../../features/shipments/lib/processor';
import { describeApiError } from '../../shared/api/describe-api-error';
import {
  ColumnsPanel,
  EditedBar,
  RepairBanner,
  ViewDialogs,
  ViewsBar,
  useListView,
  type ViewSort,
} from '../../features/saved-views';
import { createShipmentsListRegistry } from '../../features/shipments/lib/shipments.list-config';
import { ShipmentsFilterBar } from './shipments-filter-bar';
import { ShipmentPeek, type ShipmentPeekView } from './shipment-peek';

const PAGE_SIZE = SHIPMENTS_PAGE_SIZE;

function isShipmentStatus(raw: string | null): raw is ShipmentStatus {
  return raw !== null && (SHIPMENT_STATUS_VALUES as readonly string[]).includes(raw);
}

function isShippingMethod(raw: string | null): raw is ShippingMethod {
  return raw !== null && (SHIPPING_METHOD_VALUES as readonly string[]).includes(raw);
}

/**
 * Rows are one server page, sorted here: `GET /shipments` takes no sort, so a
 * view's sort orders the page on screen and never the whole list. Status
 * follows the lifecycle order, not the alphabet, so "draft" sits before
 * "delivered".
 */
function sortShipments(rows: readonly Shipment[], sort: ViewSort): Shipment[] {
  const sign = sort.dir === 'desc' ? -1 : 1;
  const value = (s: Shipment): number | string => {
    if (sort.key === 'status') return SHIPMENT_STATUS_VALUES.indexOf(s.status);
    if (sort.key === 'shippingMethod') return SHIPPING_METHOD_LABEL[s.shippingMethod];
    return s.createdAt;
  };
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === y) return b.createdAt.localeCompare(a.createdAt);
    return (x < y ? -1 : 1) * sign;
  });
}

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
      {/* #2073. BESIDE the status badge, never folded into it or into the
          severity word: a stuck relay is orthogonal to both, and a `delivered`
          shipment can carry one - the parcel arrived and the channel was still
          never told. Renders nothing unless the backend says `stuck`. */}
      <WaybillRelayStuckBadge waybillRelay={shipment.waybillRelay} />
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
  const copy = useMessages('shipments').shipmentsPage;
  const plural = usePlural();
  const format = useFormat();
  const retryLabel = useMessages('ui').common.retry;
  const [searchParams, setSearchParams] = useSearchParams();
  const [peekId, setPeekId] = useState<string | null>(null);
  // Gates the triage strips and the "to fix" cause groups, the recovery
  // actions in the peek, and the raw errorMessage text in the status cell
  // (#1826) — a `viewer` session sees a generic redaction instead of the
  // carrier's raw (possibly address-bearing) rejection message.
  const canWrite = usePermission('shipments:write');
  // Distinct from `canWrite` on purpose: the triage strip's "Review connection
  // settings" CTA edits a CONNECTION, so it follows `connections:write`. An
  // operator who may retry shipments is not automatically allowed to reconfigure
  // the carrier account.
  const canReviewConnection = usePermission('connections:write');

  const rawStatus = searchParams.get('status');
  const status = isShipmentStatus(rawStatus) ? rawStatus : undefined;
  const rawMethod = searchParams.get('shippingMethod');
  const shippingMethod = isShippingMethod(rawMethod) ? rawMethod : undefined;
  const connectionId = searchParams.get('connectionId') ?? undefined;
  const hasTracking = parseHasTracking(searchParams.get('hasTracking'));
  // Processor filter (#839). A processor implies a method slice, so it
  // overrides any `shippingMethod` via `toShipmentProcessorFilters` below and
  // the Method dropdown is locked (with a reason) while it is set.
  const processor = parseProcessorFilter(searchParams.get('processor'));
  // #2073. Present-and-'true' is the only meaningful state: there is no "not
  // stuck" cohort worth selecting, so the param is either on or absent.
  const waybillRelayStuck = searchParams.get('waybillRelayStuck') === 'true';
  const createdFrom = searchParams.get('createdFrom') ?? undefined;
  const createdTo = searchParams.get('createdTo') ?? undefined;
  const offset = Number(searchParams.get('offset') ?? '0');

  const filters: ShipmentFilters = {
    status,
    connectionId,
    hasTracking,
    waybillRelayStuck: waybillRelayStuck ? true : undefined,
    createdFrom,
    createdTo: createdTo ? inclusiveEndOfDay(createdTo) : undefined,
    // Spread the processor filter LAST so it overrides any raw `shippingMethod`
    // URL state when both are present — a defence against stale links.
    ...(processor === undefined ? { shippingMethod } : toShipmentProcessorFilters(processor)),
  };
  const pagination = { limit: PAGE_SIZE, offset };

  const query = useShipmentsQuery(filters, pagination);
  const summaryQuery = useShipmentsSummaryQuery(filters);
  const summary = summaryQuery.data;
  const connectionsQuery = useConnectionsQuery();
  const connections = useMemo(() => connectionsQuery.data ?? [], [connectionsQuery.data]);
  // One batched read, indexed once — `ConnectionCell` must never fetch per row
  // (#1996). `.get()` returns `undefined` on a miss, which the cell reads as
  // "resolve it yourself", so every lookup coalesces to `null`.
  const connectionsById = useMemo(
    () => new Map(connections.map((c) => [c.id, c])),
    [connections],
  );

  // The registry is rebuilt only when what its cells read changes: `useListView` keys its
  // memoised state on the registry's identity, so a fresh object per render would re-derive
  // every view each time.
  const cells = useMemo(() => {
    // ONE renderer for the desktop Order column and the mobile card title (#2089).
    const renderOrderCell = (s: Shipment): ReactElement => (
      <OrderIdentityCell
        orderId={s.orderId}
        orderNumber={s.orderSummary?.orderNumber}
        firstItemName={s.orderSummary?.firstItemName}
        firstItemImageUrl={s.orderSummary?.firstItemImageUrl}
        itemCount={s.orderSummary?.itemCount}
      />
    );

    const renderConnectionDot = (s: Shipment): ReactElement => {
      const connection = connectionsById.get(s.connectionId) ?? null;
      return (
        <span aria-hidden="true">
          <ConnectionDot
            name={connection?.name ?? null}
            platformType={connection?.platformType}
            variant={s.shippingMethod === 'omp' ? 'shop' : 'carrier'}
          />
        </span>
      );
    };

    // Processor with the method (and Paczkomat) folded under it (#4044): one
    // question, "who ships this and how", in one cell.
    const renderProcessor = (s: Shipment): ReactElement => (
      <span className="shipments-processor-cell">
        <ProcessorBadge processor={deriveProcessor(s)} />
        <span className="shipments-processor-cell__method">
          {SHIPPING_METHOD_LABEL[s.shippingMethod]}
          {s.paczkomatId ? ` · ${s.paczkomatId}` : null}
        </span>
      </span>
    );
    return { renderOrderCell, renderConnectionDot, renderProcessor };
  }, [connectionsById]);
  const { renderOrderCell, renderConnectionDot, renderProcessor } = cells;

  const registry = useMemo(
    () =>
      createShipmentsListRegistry(copy, {
        status: (s): ReactNode => <ShipmentStatusCell shipment={s} canWrite={canWrite} />,
        // Status + Order are the frozen pane (#1905): the row's identity.
        order: renderOrderCell,
        action: (s): ReactNode => <ShipmentSeverityLabel shipment={s} canWrite={canWrite} />,
        // The Connection column is `hideBelow: 1024`, so below that width the
        // carrier connection folds here instead (#2094); `display: none` above
        // the breakpoint, so exactly one rendering is exposed.
        processor: (s): ReactNode => (
          <span className="shipments-processor-stack">
            {renderProcessor(s)}
            <ConnectionFold
              connectionId={s.connectionId}
              connection={connectionsById.get(s.connectionId) ?? null}
              loading={connectionsQuery.isLoading}
              adornment={renderConnectionDot(s)}
            />
          </span>
        ),
        customer: (s): ReactNode =>
          s.customerId ? (
            <CustomerEntityLabel customerId={s.customerId} showId={false} />
          ) : (
            <span className="text-muted">—</span>
          ),
        // For a carrier-dispatched shipment `connectionId` is the carrier
        // connection; for an `omp`/branch-1 row it is the destination SHOP
        // connection (no OL dispatch exists), hence the `variant` split.
        // Header stays "Connection" (#1905), the vocabulary of every table.
        connection: (s): ReactNode => (
          <ConnectionCell
            connectionId={s.connectionId}
            connection={connectionsById.get(s.connectionId) ?? null}
            loading={connectionsQuery.isLoading}
            adornment={renderConnectionDot(s)}
          />
        ),
        created: (s): ReactNode => (
          <span className="shipments-created tabular text-muted">
            <TimeDisplay iso={s.createdAt} />
          </span>
        ),
      }),
    [
      copy,
      canWrite,
      connectionsById,
      connectionsQuery.isLoading,
      renderOrderCell,
      renderConnectionDot,
      renderProcessor,
    ],
  );
  const view = useListView<Shipment>({
    registry,
    pageTitle: copy.title,
    counts: {
      all: summary?.total,
      ...Object.fromEntries(SHIPMENT_STATUS_VALUES.map((value) => [value, summary?.byStatus[value]])),
    },
  });
  const sort = view.sort;

  const rows = useMemo(() => sortShipments(query.data?.items ?? [], sort), [query.data, sort]);
  const peekIndex = peekId ? rows.findIndex((s) => s.id === peekId) : -1;
  const peekShipment = peekIndex >= 0 ? rows[peekIndex] : undefined;
  const navigatePeek = useCallback(
    (step: -1 | 1): void => {
      const next = rows[peekIndex + step];
      if (next) setPeekId(next.id);
    },
    [rows, peekIndex],
  );

  const pageCauseGroups = useMemo(
    () => (status === 'failed' ? groupFailedShipmentsByCause(rows) : []),
    [rows, status],
  );

  function updateParams(mutate: (next: URLSearchParams) => void): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      mutate(next);
      next.delete('offset'); // reset pagination on filter change
      return next;
    });
  }

  function setFilter(key: string, value: string | null | undefined): void {
    updateParams((next) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
  }

  /**
   * A click that changes the filters from outside the views strip (the attention summary, a cause
   * group). The applied view id goes with it: left in place, the list would read as an edited
   * version of whichever view it was on, when the address now names its own state.
   */
  function setFilterOutsideViews(key: string, value: string | null | undefined): void {
    updateParams((next) => {
      next.delete('view');
      if (value) next.set(key, value);
      else next.delete(key);
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

  const FILTER_KEYS = [
    'shippingMethod',
    'processor',
    'connectionId',
    'hasTracking',
    'waybillRelayStuck',
    'createdFrom',
    'createdTo',
  ] as const;

  /** Clears every filter but status: the tabs own it. */
  function clearFilters(): void {
    updateParams((next) => {
      for (const key of FILTER_KEYS) next.delete(key);
    });
  }

  /** The empty state's way out: everything, status included. */
  function clearEverything(): void {
    updateParams((next) => {
      for (const key of FILTER_KEYS) next.delete(key);
      next.delete('status');
    });
  }

  function showCause(causeConnectionId: string): void {
    updateParams((next) => {
      for (const key of FILTER_KEYS) next.delete(key);
      next.delete('view');
      next.set('status', 'failed');
      next.set('connectionId', causeConnectionId);
    });
  }

  const filtersActive = Boolean(
    status ||
      shippingMethod ||
      processor ||
      connectionId ||
      hasTracking !== undefined ||
      waybillRelayStuck ||
      createdFrom ||
      createdTo,
  );
  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  const peekColumn: DataTableColumn<Shipment> = {
    id: 'peek',
    width: '3rem',
    // #4044 - the arrow says the row opens a panel from the right.
    header: <span className="sr-only">{copy.peek.details}</span>,
    cell: (s): ReactNode => (
      <PeekArrow
        label={interpolate(copy.peek.detailsAria, { id: s.orderSummary?.orderNumber ?? shortenId(s.id) })}
        onOpen={() => {
          setPeekId(s.id);
        }}
      />
    ),
  };
  const columns: DataTableColumn<Shipment>[] = [
    ...view.toColumns(),
    peekColumn,
  ];
  // The frozen pane is Status plus Order, but only while Order sits right after Status.
  const stickyLeft = view.current.columns[0] === 'orderId' ? 2 : 1;

  const renderDetail = (s: Shipment): ReactNode => (
    <ShipmentRowDetail shipment={s} canWrite={canWrite} canReviewConnection={canReviewConnection} />
  );

  const peekView: ShipmentPeekView | null = peekShipment
    ? {
        shipment: peekShipment,
        orderRef: peekShipment.orderSummary?.orderNumber ?? shortenId(peekShipment.orderId),
        meta: (
          <>
            {peekShipment.orderSummary?.firstItemName ? <span>{peekShipment.orderSummary.firstItemName}</span> : null}
            {peekShipment.customerId ? (
              <CustomerEntityLabel customerId={peekShipment.customerId} showId={false} />
            ) : null}
            <ConnectionCell
              connectionId={peekShipment.connectionId}
              connection={connectionsById.get(peekShipment.connectionId) ?? null}
              loading={connectionsQuery.isLoading}
              adornment={renderConnectionDot(peekShipment)}
            />
          </>
        ),
        status: (
          <span className="shipments-peek-status">
            <ShipmentStatusBadge status={peekShipment.status} />
            <WaybillRelayStuckBadge waybillRelay={peekShipment.waybillRelay} />
          </span>
        ),
        severity: <ShipmentSeverityLabel shipment={peekShipment} canWrite={canWrite} />,
        processor: renderProcessor(peekShipment),
        detail: renderDetail(peekShipment),
      }
    : null;

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
    >
      <div className="list-statusbar list-statusbar--views">
        <ViewsBar {...view.viewsBar} />
        <ShipmentAttentionSummary
          summary={summary}
          status={status}
          waybillRelayStuck={waybillRelayStuck}
          onStatusChange={(next) => {
            setFilterOutsideViews('status', next);
          }}
          onRelayChange={(on) => {
            setFilterOutsideViews('waybillRelayStuck', on ? 'true' : null);
          }}
          onShowCause={showCause}
          connectionName={(id) => connectionsById.get(id)?.name ?? null}
          canSeeCauses={canWrite}
          canReviewConnection={canReviewConnection}
        />
      </div>

      <ShipmentsFilterBar
        processor={processor}
        processorCounts={{ omp: summary?.byProcessor.omp, carrier: summary?.byProcessor.carrier }}
        onProcessorChange={(next) => {
          // One transaction: a processor picks the method, so a stale method goes.
          updateParams((p) => {
            if (next) {
              p.set('processor', next);
              p.delete('shippingMethod');
            } else {
              p.delete('processor');
            }
          });
        }}
        shippingMethod={processor === undefined ? shippingMethod : undefined}
        methodCounts={{
          paczkomat: summary?.byMethod.paczkomat,
          kurier: summary?.byMethod.kurier,
          pickup: summary?.byMethod.pickup,
          omp: summary?.byMethod.omp,
        }}
        onMethodChange={(next) => {
          setFilter('shippingMethod', next);
        }}
        connections={connections}
        connectionCounts={(id) => (summary ? (summary.byConnection[id] ?? 0) : undefined)}
        connectionId={connectionId}
        onConnectionChange={(next) => {
          setFilter('connectionId', next);
        }}
        hasTracking={hasTracking}
        onTrackingChange={(next) => {
          setFilter('hasTracking', next === undefined ? null : String(next));
        }}
        waybillRelayStuck={waybillRelayStuck}
        onRelayChange={(on) => {
          setFilter('waybillRelayStuck', on ? 'true' : null);
        }}
        createdFrom={createdFrom}
        createdTo={createdTo}
        onCreatedChange={(key, value) => {
          setFilter(key, value);
        }}
        resultCount={query.data ? total : null}
        onClearAll={clearFilters}
        trailing={<ColumnsPanel {...view.columnsPanel} />}
      />

      {view.editedBar ? (
        <div className="sv-applied">
          <EditedBar {...view.editedBar} />
        </div>
      ) : null}
      {view.repairBanner ? <RepairBanner {...view.repairBanner} /> : null}
      <ViewDialogs {...view.dialogs} />

      {/* Cause-first triage (#1826) on the Failed tab only (#4044): the
          strips no longer push every list down; "to fix" carries the same
          groups everywhere. admin/operator only — the cause text is the
          carrier content redacted for viewer. Page-local by design; the
          summary's groups cover every page. */}
      {canWrite && status === 'failed' ? (
        <>
          {pageCauseGroups.slice(0, MAX_TRIAGE_STRIPS).map((group) => (
            <ShipmentTriageStrip
              key={`${group.connectionId}::${group.cause}`}
              group={group}
              connectionName={connectionsById.get(group.connectionId)?.name ?? null}
              canReviewConnection={canReviewConnection}
            />
          ))}
          {pageCauseGroups.length > MAX_TRIAGE_STRIPS ? (
            <p className="text-muted shipments-page__triage-overflow">
              {plural(pageCauseGroups.length - MAX_TRIAGE_STRIPS, copy.triageOverflow)}
            </p>
          ) : null}
        </>
      ) : null}

      {query.isLoading ? (
        <DataTableSkeleton columns={columns} label={copy.loading} />
      ) : query.error ? (
        <ErrorState
          title={copy.error.title}
          message={describeApiError(query.error, 'shipments')}
          action={
            <Button
              onClick={() => {
                void query.refetch();
              }}
            >
              {retryLabel}
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          liveRegion="off"
          title={copy.empty.title}
          message={filtersActive ? copy.empty.filtered : copy.empty.none}
          action={filtersActive ? <Button onClick={clearEverything}>{copy.empty.clearFilters}</Button> : undefined}
        />
      ) : (
        <>
          <DataTable
            caption={copy.tableCaption}
            columns={columns}
            rows={rows}
            rowKey={(s) => s.id}
            // Opts this table into the 11rem frozen-pane cap for
            // `.order-cell__body` (#2089, re-scoped by #2091).
            className="shipments-table list-table--fixed list-table--peek"
            // Frozen anchor = Status + Order (#1905) — the row's identity.
            stickyLeftColumns={stickyLeft}
            stickyRightColumns={1}
            onRowClick={(s) => {
              setPeekId(s.id);
            }}
            rowClassName={(s) => (s.id === peekId ? 'list-row--peek' : undefined)}
            cardView={{
              title: renderOrderCell,
              subtitle: (s) =>
                s.customerId ? <CustomerEntityLabel customerId={s.customerId} showId={false} /> : null,
              meta: (s) => <ShipmentStatusCell shipment={s} canWrite={canWrite} />,
              summary: (s) => <ShipmentSeverityLabel shipment={s} canWrite={canWrite} />,
            }}
          />

          <div className="pagination">
            <span className="text-muted">
              {interpolate(copy.pagination.showing, {
                from: format.number(offset + 1),
                to: format.number(Math.min(offset + PAGE_SIZE, total)),
                total: format.number(total),
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

      <ShipmentPeek
        view={peekView}
        position={peekIndex + 1}
        count={rows.length}
        onNavigate={navigatePeek}
        onOpenChange={(open) => {
          if (!open) setPeekId(null);
        }}
      />
    </PageLayout>
  );
}
