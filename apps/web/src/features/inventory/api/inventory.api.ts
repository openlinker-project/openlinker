/**
 * Inventory API Client
 *
 * Thin API module for the inventory feature. Provides typed methods for
 * listing inventory items and batch availability lookups.
 *
 * @module apps/web/src/features/inventory/api
 */
import type {
  InventoryFilters,
  InventoryPagination,
  PaginatedInventory,
  InventoryAvailabilityResponse,
  DuplicatePositionsReport,
  ProvenanceBackfillStatus,
  StockView,
} from './inventory.types';
import type {
  InventoryMovementFilters,
  InventoryMovementPagination,
  InventoryMovementsPage,
} from './inventory-movements.types';
import type {
  CorrectionTarget,
  CorrectStockInput,
  CorrectStockResult,
} from './inventory-correction.types';
import type { PaginatedTotal } from '../../../shared/api/paginated-total.types';
import { normalizeCountryIso2 } from './inventory-locations.types';
import type {
  CreateInventoryLocationInput,
  InventoryLocation,
  InventoryLocationFilters,
  InventoryLocationListPagination,
  LocationBootstrapResult,
  PaginatedInventoryLocations,
  UpdateInventoryLocationInput,
} from './inventory-locations.types';

export interface InventoryApi {
  list: (filters?: InventoryFilters, pagination?: InventoryPagination) => Promise<PaginatedInventory>;
  /**
   * Batch lookup of per-variant availability (#792 PR 2). Caller is
   * responsible for deduping (the hook does this) and chunking when the
   * list exceeds the server-side cap (200 IDs per request).
   */
  availability: (productVariantIds: readonly string[]) => Promise<InventoryAvailabilityResponse>;
  /**
   * `GET /inventory/stock-view?productId=` (#3621 / #3569) - the M25 read model:
   * available to promise with provenance, the held split, positions, holds and
   * per-channel figures for every variant of one product, in one call.
   */
  stockView: (productId: string) => Promise<StockView>;
  /**
   * Active inventory locations (#2407). Only `total` is read — `limit: 1`
   * bounds the payload while `total` answers the question, so a hundred
   * locations cost the same round trip as one.
   */
  listActiveLocations: () => Promise<PaginatedInventoryLocations>;
  /**
   * Mint the first-run location, idempotently. Safe to call repeatedly: a code
   * that already exists comes back in `existingCodes` untouched.
   */
  bootstrapLocations: () => Promise<LocationBootstrapResult>;
  /**
   * Full, filtered, paginated locations read (#2316 / #3064). Named
   * `listLocations` rather than the plain `list` #3064 sketched — this
   * interface already carries `list` for inventory *items*, and the two
   * would collide — following the `listActiveLocations` /
   * `bootstrapLocations` naming this file already established.
   */
  listLocations: (
    filters?: InventoryLocationFilters,
    pagination?: InventoryLocationListPagination,
  ) => Promise<PaginatedInventoryLocations>;
  /** GET /inventory/locations/:id (#2316 / #3064). */
  getLocation: (id: string) => Promise<InventoryLocation>;
  /** POST /inventory/locations (#2316 / #3064). */
  createLocation: (input: CreateInventoryLocationInput) => Promise<InventoryLocation>;
  /** PATCH /inventory/locations/:id (#2316 / #3064). `code` cannot be patched. */
  updateLocation: (id: string, patch: UpdateInventoryLocationInput) => Promise<InventoryLocation>;
  /**
   * DELETE /inventory/locations/:id (#2316 / #3064). Refused with a 409 while
   * any `inventory_items` row still references the location — callers should
   * check `ApiError.isConflict()` and offer retire (`updateLocation(id, {
   * status: 'inactive' })`) instead. That flow is #3068's; this method only
   * issues the request.
   */
  deleteLocation: (id: string) => Promise<void>;
  /**
   * Read-only duplicate-position diagnostic (#2319, ADR-058 step (iii)). Admin
   * only server-side. `maxGroups` bounds the returned group DETAIL only — the
   * report's totals are always computed over the whole table. The server
   * rejects `maxGroups > 500` with 400 (`MAX_DUPLICATE_POSITION_GROUPS`) —
   * the authority for the cap; this client does not enforce it.
   */
  getDuplicatePositions: (maxGroups?: number) => Promise<DuplicatePositionsReport>;
  /**
   * Live status of the #2317 provenance backfill (#3240) — the second,
   * independent readiness condition alongside `getDuplicatePositions`'s
   * `groupCount`. Admin only server-side. Always resolved live — the
   * backfill's persisted `connection_cursors` count can go stale once the
   * pass self-latches, so the server recounts on every call rather than
   * trusting it — so callers should not poll this aggressively.
   */
  getProvenanceBackfillStatus: () => Promise<ProvenanceBackfillStatus>;
  /**
   * Stock movement history page (#3568). Always requested WITHOUT its total
   * (`withTotal=false`): the total is a second stage via `countMovements`.
   */
  listMovements: (
    filters?: InventoryMovementFilters,
    pagination?: InventoryMovementPagination,
  ) => Promise<InventoryMovementsPage>;
  /** GET /inventory/movements/count - the total behind `listMovements` (#3568). */
  countMovements: (filters?: InventoryMovementFilters, init?: RequestInit) => Promise<PaginatedTotal>;
  /** GET /inventory/:variantId/correction-target - which master a correction would write to (#3567). */
  getCorrectionTarget: (productVariantId: string) => Promise<CorrectionTarget>;
  /** POST /inventory/:variantId/adjust - a manual stock correction (#3567). */
  correctStock: (productVariantId: string, input: CorrectStockInput) => Promise<CorrectStockResult>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(filters?: InventoryFilters, pagination?: InventoryPagination): string {
  const params = new URLSearchParams();
  if (filters?.productId) params.set('productId', filters.productId);
  if (filters?.productVariantId) params.set('productVariantId', filters.productVariantId);
  if (filters?.locationId) params.set('locationId', filters.locationId);
  if (filters?.excludeStale) params.set('excludeStale', 'true');
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

// `countryIso2` is uppercased here to match `ListLocationsQueryDto`'s own
// note that the controller uppercases it server-side too — sending it
// pre-normalised keeps the request legible in devtools rather than relying
// on the backend to silently correct a lowercase value.
function buildLocationsQuery(
  filters?: InventoryLocationFilters,
  pagination?: InventoryLocationListPagination,
): string {
  const params = new URLSearchParams();
  if (filters?.kind) params.set('kind', filters.kind);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.countryIso2) params.set('countryIso2', normalizeCountryIso2(filters.countryIso2));
  if (filters?.codePrefix) params.set('codePrefix', filters.codePrefix);
  if (pagination?.page !== undefined) params.set('page', String(pagination.page));
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

function buildMovementsQuery(
  filters?: InventoryMovementFilters,
  pagination?: InventoryMovementPagination,
  options?: { withTotal?: false },
): string {
  const params = new URLSearchParams();
  if (filters?.productId) params.set('productId', filters.productId);
  if (filters?.productVariantId) params.set('productVariantId', filters.productVariantId);
  if (filters?.reasons && filters.reasons.length > 0) params.set('reasons', filters.reasons.join(','));
  if (filters?.sourceConnectionId) params.set('sourceConnectionId', filters.sourceConnectionId);
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  if (filters?.needsAttention) params.set('needsAttention', 'true');
  if (filters?.kind && filters.kind !== 'all') params.set('kind', filters.kind);
  if (filters?.search) params.set('search', filters.search);
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  if (options?.withTotal === false) params.set('withTotal', 'false');
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createInventoryApi(request: ApiRequest): InventoryApi {
  return {
    list(filters, pagination): Promise<PaginatedInventory> {
      return request<PaginatedInventory>(`/inventory${buildQuery(filters, pagination)}`);
    },
    stockView(productId): Promise<StockView> {
      const params = new URLSearchParams({ productId });
      return request<StockView>(`/inventory/stock-view?${params.toString()}`);
    },
    availability(productVariantIds): Promise<InventoryAvailabilityResponse> {
      const params = new URLSearchParams({ productVariantIds: productVariantIds.join(',') });
      return request<InventoryAvailabilityResponse>(`/inventory/availability?${params.toString()}`);
    },
    listActiveLocations(): Promise<PaginatedInventoryLocations> {
      return request<PaginatedInventoryLocations>('/inventory/locations?status=active&limit=1');
    },
    bootstrapLocations(): Promise<LocationBootstrapResult> {
      return request<LocationBootstrapResult>('/inventory/locations/bootstrap', { method: 'POST' });
    },
    listLocations(filters, pagination): Promise<PaginatedInventoryLocations> {
      return request<PaginatedInventoryLocations>(
        `/inventory/locations${buildLocationsQuery(filters, pagination)}`,
      );
    },
    getLocation(id): Promise<InventoryLocation> {
      return request<InventoryLocation>(`/inventory/locations/${id}`);
    },
    createLocation(input): Promise<InventoryLocation> {
      return request<InventoryLocation>('/inventory/locations', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    updateLocation(id, patch): Promise<InventoryLocation> {
      return request<InventoryLocation>(`/inventory/locations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
    },
    deleteLocation(id): Promise<void> {
      return request<void>(`/inventory/locations/${id}`, { method: 'DELETE' });
    },
    getDuplicatePositions(maxGroups): Promise<DuplicatePositionsReport> {
      const params = new URLSearchParams();
      if (maxGroups !== undefined) params.set('maxGroups', String(maxGroups));
      const qs = params.toString();
      return request<DuplicatePositionsReport>(
        `/inventory/duplicate-positions${qs.length > 0 ? `?${qs}` : ''}`,
      );
    },
    getProvenanceBackfillStatus(): Promise<ProvenanceBackfillStatus> {
      return request<ProvenanceBackfillStatus>('/inventory/provenance-backfill-status');
    },
    listMovements(filters, pagination): Promise<InventoryMovementsPage> {
      return request<InventoryMovementsPage>(
        `/inventory/movements${buildMovementsQuery(filters, pagination, { withTotal: false })}`,
      );
    },
    countMovements(filters, init): Promise<PaginatedTotal> {
      // No pagination: the answer depends on the filters alone.
      return request<PaginatedTotal>(`/inventory/movements/count${buildMovementsQuery(filters)}`, init);
    },
    getCorrectionTarget(productVariantId): Promise<CorrectionTarget> {
      return request<CorrectionTarget>(
        `/inventory/${encodeURIComponent(productVariantId)}/correction-target`,
      );
    },
    correctStock(productVariantId, input): Promise<CorrectStockResult> {
      return request<CorrectStockResult>(`/inventory/${encodeURIComponent(productVariantId)}/adjust`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
  };
}
