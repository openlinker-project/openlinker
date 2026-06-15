/**
 * Bulk Offer Creation Batch Domain Entity
 *
 * Parent aggregate for a single bulk offer-creation submission. One row per
 * "user clicks bulk-create on N variants" — `totalCount` fixes the fan-out
 * size at submission time; child OfferCreationRecord rows reference the
 * batch via their `bulkBatchId` column.
 *
 * Lifecycle: `pending → running → (completed | partially-failed | failed)`.
 * Terminal-status derivation lives in the bulk-batch progress service
 * (#736) per architecture-overview.md § 7 — not on the entity, not on the
 * repository port.
 *
 * @module libs/core/src/listings/domain/entities
 */

import type { BulkBatchStatus } from '../types/bulk-listing-batch.types';

export class BulkListingBatch {
  constructor(
    public readonly id: string,
    public readonly connectionId: string,
    public readonly initiatedBy: string,
    public readonly status: BulkBatchStatus,
    public readonly totalCount: number,
    public readonly succeededCount: number,
    public readonly failedCount: number,
    public readonly sharedConfig: Record<string, unknown>,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
