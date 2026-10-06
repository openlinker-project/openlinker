/**
 * Orders API Client
 *
 * Thin API module for the orders feature. Provides typed methods for
 * listing orders and fetching individual order details.
 *
 * @module apps/web/src/features/orders/api
 */
import type { PaginatedTotal, RowsPage } from '../../../shared/api/paginated-total.types';
import { orderMembershipFilters } from './orders.query-keys';
import { parseOrderNoteTimeline } from './order-note-timeline.schema';
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
  OrderNote,
  CreateOrderNoteRequest,
  UpdateOrderNoteRequest,
  OrderNoteTimelineEntry,
  OrderTag,
  OrderTagColorValue,
  BulkAssignOrderTagResult,
  OrderColumnPreset,
  OrderExportRun,
  CreateOrderExportRequest,
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
  /** An order's notes, oldest first (#3531). */
  listNotes: (internalOrderId: string) => Promise<OrderNote[]>;
  /** The notes' authored acts for the Activity timeline (#3531), parsed. */
  listNoteTimeline: (internalOrderId: string) => Promise<OrderNoteTimelineEntry[]>;
  createNote: (internalOrderId: string, body: CreateOrderNoteRequest) => Promise<OrderNote>;
  /** D33: the author edits their own note only; the server answers 403 otherwise. */
  updateNote: (
    internalOrderId: string,
    noteId: string,
    body: UpdateOrderNoteRequest,
  ) => Promise<OrderNote>;
  /** D33: the author or an admin. */
  deleteNote: (internalOrderId: string, noteId: string) => Promise<void>;
  /** Pin a note (author or admin). Unpins the order's previous pin, if any. */
  pinNote: (internalOrderId: string, noteId: string) => Promise<OrderNote>;
  /** Unpin a note (author or admin). */
  unpinNote: (internalOrderId: string, noteId: string) => Promise<OrderNote>;
  /** The workspace tag vocabulary, each with its live order count (#3532). */
  listTags: () => Promise<OrderTag[]>;
  /** D34: admin or operator, from the picker. Refused past the workspace limit of 50. */
  createTag: (name: string, color: OrderTagColorValue) => Promise<OrderTag>;
  /** Admin only — the Settings tag manager. */
  updateTag: (tagId: string, patch: { name?: string; color?: OrderTagColorValue }) => Promise<OrderTag>;
  /** Admin only — also removes every order assignment naming the tag. */
  deleteTag: (tagId: string) => Promise<void>;
  assignTag: (internalOrderId: string, tagId: string) => Promise<void>;
  unassignTag: (internalOrderId: string, tagId: string) => Promise<void>;
  /** Tag ids assigned to one order (#3532). */
  listOrderTags: (internalOrderId: string) => Promise<string[]>;
  /** Assign one tag to every named order — the bulk action bar (#3532). */
  bulkAssignTag: (tagId: string, orderIds: string[]) => Promise<BulkAssignOrderTagResult>;

  /** The caller's own saved column presets (#3530, D32). */
  listColumnPresets: () => Promise<OrderColumnPreset[]>;
  /** The workspace default, or `null` if an admin never set one. */
  getWorkspaceDefaultColumnPreset: () => Promise<OrderColumnPreset | null>;
  createColumnPreset: (name: string, columns: string[]) => Promise<OrderColumnPreset>;
  updateColumnPreset: (id: string, patch: { name?: string; columns?: string[] }) => Promise<OrderColumnPreset>;
  deleteColumnPreset: (id: string) => Promise<void>;
  /** Admin only. */
  setWorkspaceDefaultColumnPreset: (columns: string[]) => Promise<OrderColumnPreset>;

  /** Open an export run over the current filtered view or an explicit selection (#3534, D35). */
  requestExport: (body: CreateOrderExportRequest) => Promise<OrderExportRun>;
  getExportRun: (runId: string) => Promise<OrderExportRun>;
  /**
   * The generated file, as a Blob — the API requires a Bearer token, so a
   * plain `<a href>` cannot carry it (the `invoicing`/`shipments` download
   * precedent, `requestBlob` + `triggerBlobDownload`).
   */
  downloadExport: (runId: string) => Promise<Blob>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

interface ApiBlobRequest {
  (path: string, init?: RequestInit): Promise<Blob>;
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
  // #2997 — boolean, same `!== undefined` guard: `false` ("exclude packed
  // orders") is a real predicate.
  if (filters?.packed !== undefined) {
    params.set('packed', String(filters.packed));
  }
  // #3527/#3528 — free text, debounced client-side before landing here.
  if (filters?.search) params.set('search', filters.search);
  // #2998 — boolean, same `!== undefined` guard as its neighbours.
  if (filters?.openReturn !== undefined) {
    params.set('openReturn', String(filters.openReturn));
  }
  // #3532 — `tag` and `untagged` are mutually exclusive by convention.
  if (filters?.tag) params.set('tag', filters.tag);
  if (filters?.untagged !== undefined) {
    params.set('untagged', String(filters.untagged));
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

export function createOrdersApi(request: ApiRequest, requestBlob: ApiBlobRequest): OrdersApi {
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
      // Neither pagination nor sort: the answer depends on membership alone,
      // which is what lets one cached count serve every page AND every column
      // ordering of a result set. Stripped here as well as in the query key so
      // the URL matches what the key claims about it - the backend accepts and
      // ignores both, but sending them would make two identical answers look
      // like two different requests in a log (#2957 review, I3).
      return request<PaginatedTotal>(
        `/orders/count${buildQuery(orderMembershipFilters(filters))}`,
        init,
      );
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
    listNotes(internalOrderId): Promise<OrderNote[]> {
      return request<OrderNote[]>(`/orders/${encodeURIComponent(internalOrderId)}/notes`);
    },
    async listNoteTimeline(internalOrderId): Promise<OrderNoteTimelineEntry[]> {
      const raw = await request<unknown>(
        `/orders/${encodeURIComponent(internalOrderId)}/notes/timeline`,
      );
      return parseOrderNoteTimeline(raw);
    },
    createNote(internalOrderId, body): Promise<OrderNote> {
      return request<OrderNote>(`/orders/${encodeURIComponent(internalOrderId)}/notes`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    updateNote(internalOrderId, noteId, body): Promise<OrderNote> {
      return request<OrderNote>(
        `/orders/${encodeURIComponent(internalOrderId)}/notes/${encodeURIComponent(noteId)}`,
        { method: 'PUT', body: JSON.stringify(body) },
      );
    },
    deleteNote(internalOrderId, noteId): Promise<void> {
      return request<void>(
        `/orders/${encodeURIComponent(internalOrderId)}/notes/${encodeURIComponent(noteId)}`,
        { method: 'DELETE' },
      );
    },
    pinNote(internalOrderId, noteId): Promise<OrderNote> {
      return request<OrderNote>(
        `/orders/${encodeURIComponent(internalOrderId)}/notes/${encodeURIComponent(noteId)}/pin`,
        { method: 'POST' },
      );
    },
    unpinNote(internalOrderId, noteId): Promise<OrderNote> {
      return request<OrderNote>(
        `/orders/${encodeURIComponent(internalOrderId)}/notes/${encodeURIComponent(noteId)}/pin`,
        { method: 'DELETE' },
      );
    },
    listTags(): Promise<OrderTag[]> {
      return request<OrderTag[]>('/order-tags');
    },
    createTag(name, color): Promise<OrderTag> {
      return request<OrderTag>('/order-tags', {
        method: 'POST',
        body: JSON.stringify({ name, color }),
      });
    },
    updateTag(tagId, patch): Promise<OrderTag> {
      return request<OrderTag>(`/order-tags/${encodeURIComponent(tagId)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
    },
    deleteTag(tagId): Promise<void> {
      return request<void>(`/order-tags/${encodeURIComponent(tagId)}`, { method: 'DELETE' });
    },
    bulkAssignTag(tagId, orderIds): Promise<BulkAssignOrderTagResult> {
      return request<BulkAssignOrderTagResult>(
        `/order-tags/${encodeURIComponent(tagId)}/bulk-assign`,
        { method: 'POST', body: JSON.stringify({ orderIds }) },
      );
    },
    assignTag(internalOrderId, tagId): Promise<void> {
      return request<void>(`/orders/${encodeURIComponent(internalOrderId)}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tagId }),
      });
    },
    unassignTag(internalOrderId, tagId): Promise<void> {
      return request<void>(
        `/orders/${encodeURIComponent(internalOrderId)}/tags/${encodeURIComponent(tagId)}`,
        { method: 'DELETE' },
      );
    },
    listOrderTags(internalOrderId): Promise<string[]> {
      return request<string[]>(`/orders/${encodeURIComponent(internalOrderId)}/tags`);
    },
    listColumnPresets(): Promise<OrderColumnPreset[]> {
      return request<OrderColumnPreset[]>('/orders/column-presets');
    },
    getWorkspaceDefaultColumnPreset(): Promise<OrderColumnPreset | null> {
      return request<OrderColumnPreset | null>('/orders/column-presets/workspace-default');
    },
    createColumnPreset(name, columns): Promise<OrderColumnPreset> {
      return request<OrderColumnPreset>('/orders/column-presets', {
        method: 'POST',
        body: JSON.stringify({ name, columns }),
      });
    },
    updateColumnPreset(id, patch): Promise<OrderColumnPreset> {
      return request<OrderColumnPreset>(`/orders/column-presets/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
    },
    deleteColumnPreset(id): Promise<void> {
      return request<void>(`/orders/column-presets/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    },
    setWorkspaceDefaultColumnPreset(columns): Promise<OrderColumnPreset> {
      return request<OrderColumnPreset>('/orders/column-presets/workspace-default', {
        method: 'PUT',
        body: JSON.stringify({ columns }),
      });
    },
    requestExport(body): Promise<OrderExportRun> {
      return request<OrderExportRun>('/orders/export', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    getExportRun(runId): Promise<OrderExportRun> {
      return request<OrderExportRun>(`/orders/export/${encodeURIComponent(runId)}`);
    },
    downloadExport(runId): Promise<Blob> {
      return requestBlob(`/orders/export/${encodeURIComponent(runId)}/download`);
    },
  };
}
