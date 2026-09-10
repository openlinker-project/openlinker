/**
 * Price Changes API Client (#3147)
 *
 * @module apps/web/src/features/price-changes/api
 */
import type { ApiRequest } from '../../../app/api/api-client';
import type {
  AcceptPriceChangeInput,
  BulkAcceptPriceChangeItem,
  BulkAcceptPriceChangesResponse,
  EditPriceChangeInput,
  ListPriceChangesFilters,
  PriceChangeAutoAppliedItem,
  PriceChangeListResponse,
} from './price-changes.types';

function buildQuery(filters?: ListPriceChangesFilters): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  if (filters.connectionId) params.set('connectionId', filters.connectionId);
  if (filters.direction) params.set('direction', filters.direction);
  if (filters.magnitudeLarge) params.set('magnitudeLarge', 'true');
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export interface PriceChangesApi {
  list(filters?: ListPriceChangesFilters): Promise<PriceChangeListResponse>;
  accept(id: string, input: AcceptPriceChangeInput): Promise<void>;
  ignore(id: string): Promise<void>;
  unresolve(id: string): Promise<void>;
  edit(id: string, input: EditPriceChangeInput): Promise<void>;
  bulkAccept(items: BulkAcceptPriceChangeItem[]): Promise<BulkAcceptPriceChangesResponse>;
  autoApplied(): Promise<PriceChangeAutoAppliedItem[]>;
}

export function createPriceChangesApi(request: ApiRequest): PriceChangesApi {
  return {
    list(filters): Promise<PriceChangeListResponse> {
      return request<PriceChangeListResponse>(`/listings/price-changes${buildQuery(filters)}`);
    },
    accept(id, input): Promise<void> {
      return request<void>(`/listings/price-changes/${id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
    },
    ignore(id): Promise<void> {
      return request<void>(`/listings/price-changes/${id}/ignore`, { method: 'POST' });
    },
    unresolve(id): Promise<void> {
      return request<void>(`/listings/price-changes/${id}/unresolve`, { method: 'POST' });
    },
    edit(id, input): Promise<void> {
      return request<void>(`/listings/price-changes/${id}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
    },
    bulkAccept(items): Promise<BulkAcceptPriceChangesResponse> {
      return request<BulkAcceptPriceChangesResponse>('/listings/price-changes/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
    },
    autoApplied(): Promise<PriceChangeAutoAppliedItem[]> {
      return request<PriceChangeAutoAppliedItem[]>('/listings/price-changes/auto-applied');
    },
  };
}
