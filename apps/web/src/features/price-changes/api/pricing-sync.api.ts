/**
 * Pricing Sync API Client (#3146's `GET`/`PATCH /connections/:id/pricing-sync`)
 *
 * A minimal client added here (rather than deferring entirely to #3149) so
 * #3148's "also set to Automatic" opt-in has a real Undo: reverting a mode
 * flip needs a read-modify-write against the same endpoint the opt-in itself
 * writes through. #3149 is expected to build the full settings PAGE on top
 * of this same client — nothing here is settings-page-specific.
 *
 * @module apps/web/src/features/price-changes/api
 */
import type { ApiRequest } from '../../../app/api/api-client';
import type { ConnectionPricingSyncView, UpdatePricingSyncInput } from './pricing-sync.types';

export interface PricingSyncApi {
  get(connectionId: string): Promise<ConnectionPricingSyncView>;
  update(connectionId: string, input: UpdatePricingSyncInput): Promise<ConnectionPricingSyncView>;
}

export function createPricingSyncApi(request: ApiRequest): PricingSyncApi {
  return {
    get(connectionId): Promise<ConnectionPricingSyncView> {
      return request<ConnectionPricingSyncView>(`/connections/${connectionId}/pricing-sync`);
    },
    update(connectionId, input): Promise<ConnectionPricingSyncView> {
      return request<ConnectionPricingSyncView>(`/connections/${connectionId}/pricing-sync`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
    },
  };
}
