/**
 * Offer Commercial Snapshot Repository Port
 *
 * Persistence contract for `offer_commercial_snapshots` rows (#2024) — the
 * periodically-refreshed channel-side price/currency/available-quantity of
 * mapped offers. Intentionally minimal, mirroring
 * `OfferStatusSnapshotRepositoryPort`: the steady-state status-sync service
 * needs only a keyed read and an upsert. Does not mirror the TypeORM
 * `Repository<T>` surface.
 *
 * @module libs/core/src/listings/domain/ports
 */
import type { OfferCommercialSnapshot } from '../entities/offer-commercial-snapshot.entity';
import type { UpsertOfferCommercialSnapshotCommand } from '../types/offer-commercial-snapshot.types';

export interface OfferCommercialSnapshotRepositoryPort {
  /**
   * Look up the snapshot for a `(connectionId, externalOfferId)` pair.
   * Returns `null` when the offer has never had a commercial observation
   * persisted.
   */
  findByConnectionAndExternalOfferId(
    connectionId: string,
    externalOfferId: string
  ): Promise<OfferCommercialSnapshot | null>;

  /**
   * Insert a new snapshot or update the existing `(connectionId,
   * externalOfferId)` row, always refreshing `lastCommercialSyncedAt`.
   * Implementations must be safe under concurrent upserts of the same key
   * (unique-constraint races resolve to an update on retry).
   */
  upsert(command: UpsertOfferCommercialSnapshotCommand): Promise<OfferCommercialSnapshot>;
}
