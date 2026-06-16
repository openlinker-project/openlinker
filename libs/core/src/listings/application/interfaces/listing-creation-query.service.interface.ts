/**
 * Listing Creation Query Service Interface
 *
 * Read-side contract for `ListingCreationRecord` (#1044) — backs the
 * shop-publish status-polling endpoint. Kept separate from the write-side
 * enqueue/execution services so the API read path depends on a narrow query
 * surface, not the mutation services.
 *
 * @module libs/core/src/listings/application/interfaces
 */

import type { ListingCreationRecord } from '../../domain/entities/listing-creation-record.entity';

export interface IListingCreationQueryService {
  /** Fetch a single publish record by id, or null when it does not exist. */
  getById(recordId: string): Promise<ListingCreationRecord | null>;
}
