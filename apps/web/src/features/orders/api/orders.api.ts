/**
 * Orders API Client
 *
 * Thin API module for the orders feature. Provides typed methods for
 * listing orders and fetching individual order details.
 *
 * @module apps/web/src/features/orders/api
 */
import type { PaginatedTotal, RowsPage } from '../../../shared/api/paginated-total.types';
import type {
  OrderFilters,
  OrderPagination,
  PaginatedOrders,
  OrderRecord,
  RetryOrderDestinationResult,
  OrderHealthSummary,
  OrderHealthSummaryFilters,
  OrderSlaSummary,
  OrderLifecyclePhaseSummary,
  PlaceOrderHoldRequest,
  PlaceOrderHoldResult,
  ReleaseOrderHoldRequest,
  ReleaseOrderHoldResult,
} from './orders.types';

export interface OrdersApi {
  list: (filters?: OrderFilters, pagination?: OrderPagination) => Promise<PaginatedOrders>;
  /**
   * The page WITHOUT its total (#2947). Pair with {@link OrdersApi.count}.
   *
   * This is the read #2843 measured: at a million rows the count was 142 ms of
   * a 149 ms request, because `syncStatus @> ...` is a jsonb containment no
   * plain index serves and a count cannot stop after twenty matches.
   */
  listRows: (
    filters?: OrderFilters,
    pagination?: OrderPagination,
  ) => Promise<RowsPage<OrderRecord>>;
  /** The total WITHOUT its page (#2947). Takes the filters alone. */
  count: (filters?: OrderFilters, init?: RequestInit) => Promise<PaginatedTotal>;
  statusSummary: (filters?: OrderHealthSummaryFilters) => Promise<OrderHealthSummary>;
  slaSummary: (filters?: OrderHealthSummaryFilters) => Promise<OrderSlaSummary>;
  /** Per-lifecycle-phase counts (#2310) — the chip-row counts on the orders list. */
  lifecycleSummary: (filters?: OrderHealthSummaryFilters) => Promise<OrderLifecyclePhaseSummary>;
  getById: (internalOrderId: string) => Promise<OrderRecord>;
  retryDestination: (
    internalOrderId: string,
    destinationConnectionId: string,
  ) => Promise<RetryOrderDestinationResult>;
  /**
   * Mark the order packed (#2287). Returns the updated record, and returns 200
   * on an idempotent replay too — marking an already-packed order keeps the
   * FIRST actor and instant rather than restamping them.
   */
  markPacked: (internalOrderId: string) => Promise<OrderRecord>;
  /** Clear the packed mark (#2287). Clearing an unpacked order is a no-op 200. */
  unmarkPacked: (internalOrderId: string) => Promise<OrderRecord>;
  /**
   * Place a hold (#2341). Admin-only server-side; a second hold on an order
   * that already has one answers 409 `ORDER_ALREADY_ON_HOLD`.
   */
  placeHold: (
    internalOrderId: string,
    body: PlaceOrderHoldRequest,
  ) => Promise<PlaceOrderHoldResult>;
  /**
   * Release a hold (#2341). Admin-only. Answers 409 `HOLD_ALREADY_RELEASED` on
   * a replay and 400 when a note is required and missing; the success body
   * reports what happened to the provisioning run the hold was suppressing.
   */
  releaseHold: (
    internalOrderId: string,
    holdId: string,
    body: ReleaseOrderHoldRequest,
  ) => Promise<ReleaseOrderHoldResult>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(
  filters?: OrderFilters,
  pagination?: OrderPagination,
  options?: { withTotal?: false },
): string {
  const params = new URLSearchParams();
  if (filters?.sourceConnectionId) params.set('sourceConnectionId', filters.sourceConnectionId);
  if (filters?.syncStatus) params.set('syncStatus', filters.syncStatus);
  if (filters?.customerId) params.set('customerId', filters.customerId);
  if (filters?.createdFrom) params.set('createdFrom', filters.createdFrom);
  if (filters?.createdTo) params.set('createdTo', filters.createdTo);
  if (filters?.recordStatus) params.set('recordStatus', filters.recordStatus);
  if (filters?.health) params.set('health', filters.health);
  if (filters?.sort) params.set('sort', filters.sort);
  if (filters?.dir) params.set('dir', filters.dir);
  if (filters?.dueBefore) params.set('dueBefore', filters.dueBefore);
  if (filters?.slaState) params.set('slaState', filters.slaState);
  if (filters?.fulfillmentState) params.set('fulfillmentState', filters.fulfillmentState);
  // #2310 — the derived lifecycle phase, an axis orthogonal to `health`; both
  // can be applied at once and the server ANDs them.
  if (filters?.phase) params.set('phase', filters.phase);
  // #2342 — the reason axis `?phase=held` cannot express. Reason-scoped only,
  // so there is no boolean form to translate here.
  if (filters?.holdReason) params.set('hold', filters.holdReason);
  // #2100 — a boolean, so it needs the `!== undefined` guard the truthy checks
  // above don't: `false` ("exclude blocked orders") is a real predicate.
  if (filters?.salesDocumentBlocked !== undefined) {
    params.set('salesDocumentBlocked', String(filters.salesDocumentBlocked));
  }
  // #2306 — boolean, same `!== undefined` guard as above: `false` ("exclude
  // cancelled orders") is a real predicate the dispatch-risk page depends on.
  if (filters?.cancelled !== undefined) {
    params.set('cancelled', String(filters.cancelled));
  }
  // #2353 - boolean, so it needs the `!== undefined` guard for the same reason
  // its two neighbours do: `false` ("exclude orders with an inert state") is a
  // real predicate the backend honours, and a truthy check would silently drop
  // it. The param is the operator-facing `attention`; the repository filter
  // names the full `omsAttention` axis.
  if (filters?.attention !== undefined) {
    params.set('attention', String(filters.attention));
  }
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  if (options?.withTotal === false) params.set('withTotal', 'false');
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

function buildSummaryQuery(filters?: OrderHealthSummaryFilters): string {
  const params = new URLSearchParams();
  if (filters?.sourceConnectionId) params.set('sourceConnectionId', filters.sourceConnectionId);
  if (filters?.customerId) params.set('customerId', filters.customerId);
  if (filters?.createdFrom) params.set('createdFrom', filters.createdFrom);
  if (filters?.createdTo) params.set('createdTo', filters.createdTo);
  // #2306 — only `GET /orders/sla-summary` honours this; `status-summary`
  // ignores an unknown extra param, and no caller passes it there.
  if (filters?.cancelled !== undefined) {
    params.set('cancelled', String(filters.cancelled));
  }
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createOrdersApi(request: ApiRequest): OrdersApi {
  return {
    list(filters, pagination): Promise<PaginatedOrders> {
      return request<PaginatedOrders>(`/orders${buildQuery(filters, pagination)}`);
    },
    listRows(filters, pagination): Promise<RowsPage<OrderRecord>> {
      return request<RowsPage<OrderRecord>>(
        `/orders${buildQuery(filters, pagination, { withTotal: false })}`,
      );
    },
    count(filters, init): Promise<PaginatedTotal> {
      // No pagination: the answer depends on the filters alone, which is what
      // lets one cached count serve every page of a result set.
      return request<PaginatedTotal>(`/orders/count${buildQuery(filters)}`, init);
    },
    statusSummary(filters): Promise<OrderHealthSummary> {
      return request<OrderHealthSummary>(`/orders/status-summary${buildSummaryQuery(filters)}`);
    },
    slaSummary(filters): Promise<OrderSlaSummary> {
      return request<OrderSlaSummary>(`/orders/sla-summary${buildSummaryQuery(filters)}`);
    },
    lifecycleSummary(filters): Promise<OrderLifecyclePhaseSummary> {
      return request<OrderLifecyclePhaseSummary>(
        `/orders/lifecycle-summary${buildSummaryQuery(filters)}`,
      );
    },
    getById(internalOrderId): Promise<OrderRecord> {
      return request<OrderRecord>(`/orders/${internalOrderId}`);
    },
    retryDestination(internalOrderId, destinationConnectionId): Promise<RetryOrderDestinationResult> {
      return request<RetryOrderDestinationResult>(
        `/orders/${encodeURIComponent(internalOrderId)}/destinations/${encodeURIComponent(destinationConnectionId)}/retry`,
        { method: 'POST' },
      );
    },
    markPacked(internalOrderId): Promise<OrderRecord> {
      return request<OrderRecord>(`/orders/${encodeURIComponent(internalOrderId)}/packed`, {
        method: 'POST',
      });
    },
    unmarkPacked(internalOrderId): Promise<OrderRecord> {
      return request<OrderRecord>(`/orders/${encodeURIComponent(internalOrderId)}/packed`, {
        method: 'DELETE',
      });
    },
    placeHold(internalOrderId, body): Promise<PlaceOrderHoldResult> {
      return request<PlaceOrderHoldResult>(
        `/orders/${encodeURIComponent(internalOrderId)}/holds`,
        { method: 'POST', body: JSON.stringify(body) },
      );
    },
    releaseHold(internalOrderId, holdId, body): Promise<ReleaseOrderHoldResult> {
      return request<ReleaseOrderHoldResult>(
        `/orders/${encodeURIComponent(internalOrderId)}/holds/${encodeURIComponent(holdId)}/release`,
        { method: 'POST', body: JSON.stringify(body) },
      );
    },
  };
}
