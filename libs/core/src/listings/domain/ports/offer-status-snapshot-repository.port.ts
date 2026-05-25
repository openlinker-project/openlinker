/**
 * Offer Status Snapshot Repository Port
 *
 * Persistence contract for `offer_status_snapshots` rows (#816) — the
 * periodically-refreshed marketplace publication status of mapped offers.
 * Intentionally minimal: the steady-state status-sync service needs only a
 * keyed read, an upsert, and a per-status count (for observability / future
 * dashboards). Does not mirror the TypeORM `Repository<T>` surface.
 *
 * @module libs/core/src/listings/domain/ports
 */
import type { OfferStatusSnapshot } from '../entities/offer-status-snapshot.entity';
import type { UpsertOfferStatusSnapshotCommand } from '../types/offer-status-snapshot.types';
import type { OfferPublicationStatus } from '../types/offer-status-read.types';

/**
 * Result of {@link OfferStatusSnapshotRepositoryPort.upsert}. Carries the
 * persisted snapshot plus the publication status the row held *before* this
 * write (`null` on first insert) so the caller can detect a status transition
 * without a second read. Defined here (next to the port) rather than in
 * `offer-status-snapshot.types.ts` to avoid a type-only import cycle between
 * the types module and the entity it references.
 */
export interface OfferStatusUpsertResult {
  snapshot: OfferStatusSnapshot;
  previousStatus: OfferPublicationStatus | null;
}

export interface OfferStatusSnapshotRepositoryPort {
  /**
   * Look up the snapshot for a `(connectionId, externalOfferId)` pair.
   * Returns `null` when the offer has never been synced.
   */
  findByConnectionAndExternalOfferId(
    connectionId: string,
    externalOfferId: string
  ): Promise<OfferStatusSnapshot | null>;

  /**
   * Insert a new snapshot or update the existing `(connectionId,
   * externalOfferId)` row, always refreshing `lastStatusSyncedAt`. Returns the
   * persisted snapshot plus the row's previous publication status (`null` on
   * first insert) so callers detect transitions without a second read.
   * Implementations must be safe under concurrent upserts of the same key
   * (unique-constraint races resolve to an update on retry).
   */
  upsert(command: UpsertOfferStatusSnapshotCommand): Promise<OfferStatusUpsertResult>;

  /**
   * Count snapshots for a connection grouped by publication status. Keys with
   * zero snapshots are omitted. For observability / future status dashboards.
   */
  countByConnectionAndStatus(
    connectionId: string
  ): Promise<Map<OfferPublicationStatus, number>>;
}
