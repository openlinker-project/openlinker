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
   * Implementations MUST be atomic (#2032 review thread 5): `refreshOne` (the
   * sole write path) is reachable from three independent triggers - the
   * hourly scan, the delayed post-creation refresh, and the operator
   * "Refresh status" endpoint - so a genuine same-key INSERT/INSERT race is
   * reachable, unlike `OfferStatusSnapshotRepositoryPort.upsert`'s
   * effectively-single-writer posture. Returns `void`: no caller reads the
   * persisted row back.
   */
  upsert(command: UpsertOfferCommercialSnapshotCommand): Promise<void>;

  /**
   * Every snapshot for the given internal variant ids (#3621) - the first
   * keyed read, arriving with its first consumer as this port's docblock
   * promised. One parameterised statement; empty input returns `[]` without a
   * storage round trip. A variant listed on several offers yields several rows.
   */
  findByVariantIds(variantIds: readonly string[]): Promise<OfferCommercialSnapshot[]>;
}
