/**
 * Orders API Client
 *
 * Thin API module for the orders feature. Provides typed methods for
 * listing orders and fetching individual order details.
 *
 * @module apps/web/src/features/orders/api
 */
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
} from './orders.types';

export interface OrdersApi {
  list: (filters?: OrderFilters, pagination?: OrderPagination) => Promise<PaginatedOrders>;
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
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(filters?: OrderFilters, pagination?: OrderPagination): string {
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
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
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
  };
}
