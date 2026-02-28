/**
 * Offer Mapping Sync Service Interface
 *
 * @module libs/core/src/listings/application/services
 */

export interface OfferMappingSyncOptions {
  limit: number;
  cursor?: string | null;
  feedType?: 'offers' | 'events';
  masterConnectionId?: string | null;
}

export interface OfferMappingSyncResult {
  scanned: number;
  linked: number;
  skipped: number;
  nextCursor: string | null;
}

export interface IOfferMappingSyncService {
  sync(connectionId: string, options: OfferMappingSyncOptions): Promise<OfferMappingSyncResult>;
}
