/**
 * Offer Commercial Snapshot Repository Port
 *
 * Persistence contract for `offer_commercial_snapshots` rows (#2024) — the
 * periodically-refreshed channel-side price/currency/available-quantity of
 * mapped offers. Intentionally minimal, mirroring
 * `OfferStatusSnapshotRepositoryPort`: the steady-state status-sync service
 * needs only an upsert. Does not mirror the TypeORM `Repository<T>` surface;
 * a keyed read arrives with its first consumer.
 *
 * @module libs/core/src/listings/domain/ports
 */
import type { OfferCommercialSnapshot } from '../entities/offer-commercial-snapshot.entity';
import type { UpsertOfferCommercialSnapshotCommand } from '../types/offer-commercial-snapshot.types';

export interface OfferCommercialSnapshotRepositoryPort {
  /**
   * Insert a new snapshot or update the existing `(connectionId,
   * externalOfferId)` row, always refreshing `lastCommercialSyncedAt`.
   *
   * Implementations need not be atomic. The writing job is effectively
   * single-writer per connection (the scheduler dedups concurrent runs via a
   * per-minute idempotency key and advances the scan cursor sequentially), and
   * the one caller that can race it - the delayed `refreshSnapshot` job -
   * treats a failed commercial write as non-fatal and logs it, so a losing
   * INSERT costs one skipped observation until the next pass, never a wedged
   * sync. Same reasoning as `OfferStatusSnapshotRepositoryPort.upsert`.
   */
  upsert(command: UpsertOfferCommercialSnapshotCommand): Promise<OfferCommercialSnapshot>;
}
