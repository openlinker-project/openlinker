/**
 * Connection Pricing & Sync Service Interface (#3146, ADR-072)
 *
 * @module apps/api/src/integrations/application/interfaces
 */
import type {
  ConnectionAsSourceEntry,
  ConnectionPricingSyncView,
  UpdateConnectionPricingSyncInput,
} from '../types/connection-pricing-sync.types';

export const CONNECTION_PRICING_SYNC_SERVICE_TOKEN = Symbol('IConnectionPricingSyncService');

export interface IConnectionPricingSyncService {
  getPricingSync(connectionId: string): Promise<ConnectionPricingSyncView>;
  updatePricingSync(
    connectionId: string,
    input: UpdateConnectionPricingSyncInput
  ): Promise<ConnectionPricingSyncView>;
  /** READ-ONLY rollup for a connection acting as a SOURCE (ADR-072 decision 2). */
  getAsSource(connectionId: string): Promise<ConnectionAsSourceEntry[]>;
}
