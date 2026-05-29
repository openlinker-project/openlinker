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
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
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

export function createShipmentsApi(request: ApiRequest): ShipmentsApi {
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
  };
}
