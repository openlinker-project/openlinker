/**
 * Shipments API Client
 *
 * Thin API module for the shipments feature (#770). Read-only list of
 * shipments across orders + connections, consuming the `GET /shipments`
 * paginated + filtered endpoint (#846 + #770 customer enrichment).
 *
 * @module apps/web/src/features/shipments/api
 */
import type {
  BulkDispatchResult,
  BulkGenerateLabelsInput,
  DispatchResult,
  GenerateLabelInput,
  NotifyDispatchedResult,
  PaginatedShipments,
  Shipment,
  ShipmentFilters,
  ShipmentPagination,
} from './shipments.types';

export interface ShipmentsApi {
  /**
   * List shipments with optional filters + pagination.
   *
   * NOTE: the backend enforces `pagination.limit` <= `SHIPMENTS_MAX_LIMIT`
   * (100); higher values return HTTP 400. Page via `offset`.
   */
  list: (filters?: ShipmentFilters, pagination?: ShipmentPagination) => Promise<PaginatedShipments>;

  /** `POST /shipments/generate-label` — kicks off the #835 dispatch seam.
   *  Returns `kind: 'dispatched'` + `shipment` for OL-managed dispatches;
   *  `kind: 'omp_fulfilled'` + no shipment when the routing rule resolves to
   *  the OMP-fulfilled branch (no OL-side label). */
  generateLabel: (input: GenerateLabelInput) => Promise<DispatchResult>;

  /** `POST /shipments/:id/cancel` — voids a not-yet-dispatched shipment. */
  cancel: (id: string) => Promise<Shipment>;

  /** `POST /shipments/:id/notify-dispatched` (#769) — fires the #837 source
   *  notify + destination OMP projection. Idempotent: re-firing on an
   *  already-dispatched shipment returns `outcome: 'skipped-not-generated'`. */
  notifyDispatched: (id: string) => Promise<NotifyDispatchedResult>;

  /** `GET /shipments/:id/label` (#884) — fetch the label document bytes as a
   *  Blob. Content type is provider-dependent (PDF / ZPL / PNG); the browser
   *  filename comes from the server's `Content-Disposition` header. */
  downloadLabel: (id: string) => Promise<Blob>;

  /** `POST /shipments/bulk/generate-labels` (#1109) — batch-dispatch up to 25
   *  orders for ONE source connection. Returns 200 with a per-order result for
   *  every item even on partial failure (`kind: dispatched | omp_fulfilled |
   *  failed`). The UI fans out one call per source group. */
  bulkGenerateLabels: (input: BulkGenerateLabelsInput) => Promise<BulkDispatchResult>;

  /** `POST /shipments/bulk/protocol` (#1109) — carrier handover protocol for a
   *  set of dispatched shipments as a Blob. The BE rejects mixed-carrier batches,
   *  so the caller passes shipment ids grouped by a single carrier connection. */
  downloadProtocol: (shipmentIds: string[]) => Promise<Blob>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

interface ApiBlobRequest {
  (path: string, init?: RequestInit): Promise<Blob>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

function buildQuery(filters?: ShipmentFilters, pagination?: ShipmentPagination): string {
  const params = new URLSearchParams();
  if (filters?.orderId) params.set('orderId', filters.orderId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.connectionId) params.set('connectionId', filters.connectionId);
  if (filters?.shippingMethod) params.set('shippingMethod', filters.shippingMethod);
  if (filters?.hasTracking !== undefined) params.set('hasTracking', String(filters.hasTracking));
  if (filters?.hasProviderShipmentId !== undefined)
    params.set('hasProviderShipmentId', String(filters.hasProviderShipmentId));
  if (filters?.createdFrom) params.set('createdFrom', filters.createdFrom);
  if (filters?.createdTo) params.set('createdTo', filters.createdTo);
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createShipmentsApi(
  request: ApiRequest,
  requestBlob: ApiBlobRequest,
): ShipmentsApi {
  return {
    list(filters, pagination): Promise<PaginatedShipments> {
      return request<PaginatedShipments>(`/shipments${buildQuery(filters, pagination)}`);
    },
    generateLabel(input): Promise<DispatchResult> {
      return request<DispatchResult>('/shipments/generate-label', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(input),
      });
    },
    cancel(id): Promise<Shipment> {
      return request<Shipment>(`/shipments/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        headers: JSON_HEADERS,
      });
    },
    notifyDispatched(id): Promise<NotifyDispatchedResult> {
      return request<NotifyDispatchedResult>(
        `/shipments/${encodeURIComponent(id)}/notify-dispatched`,
        {
          method: 'POST',
          headers: JSON_HEADERS,
        },
      );
    },
    downloadLabel(id): Promise<Blob> {
      return requestBlob(`/shipments/${encodeURIComponent(id)}/label`);
    },
    bulkGenerateLabels(input): Promise<BulkDispatchResult> {
      return request<BulkDispatchResult>('/shipments/bulk/generate-labels', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(input),
      });
    },
    downloadProtocol(shipmentIds): Promise<Blob> {
      return requestBlob('/shipments/bulk/protocol', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ shipmentIds }),
      });
    },
  };
}
