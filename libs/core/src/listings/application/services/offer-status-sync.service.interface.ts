/**
 * Offer Status Sync Service Interface
 *
 * Contract for the steady-state marketplace offer-status refresh (#816):
 * read the live publication status of mapped offers for a connection and
 * persist it into `offer_status_snapshots`. Enumeration is paged via a numeric
 * scan offset; the caller (worker handler) persists `nextOffset` for the next
 * run.
 *
 * @module libs/core/src/listings/application/services
 */
import type { OfferStatusSyncResult } from '../../domain/types/offer-status-snapshot.types';

export interface OfferStatusSyncOptions {
  /** Page size: number of mapped offers to refresh this run. */
  limit: number;
  /** Scan offset into the connection's offer mappings. Defaults to 0. */
  offset?: number;
}

export type { OfferStatusSyncResult };

export interface IOfferStatusSyncService {
  /**
   * Refresh and persist the publication status of one page of the
   * connection's mapped offers. Returns counters plus `nextOffset` (wraps to
   * 0 at the end of the catalog). Connections whose adapter does not support
   * `OfferStatusReader` are skipped with a zeroed result.
   */
  sync(connectionId: string, options: OfferStatusSyncOptions): Promise<OfferStatusSyncResult>;
}
