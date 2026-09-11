/**
 * Price Change Auto-Applied Log Repository Port (#3144, ADR-072 decision 3)
 *
 * @module libs/core/src/listings/domain/ports
 */
import type { PriceChangeAutoAppliedLogEntry } from '../entities/price-change-auto-applied-log-entry.entity';
import type { RecordAutoAppliedPriceChangeInput } from '../types/price-change-auto-applied-log.types';

export interface PriceChangeAutoAppliedLogRepositoryPort {
  record(input: RecordAutoAppliedPriceChangeInput): Promise<PriceChangeAutoAppliedLogEntry>;

  /**
   * The most recent N entries, newest first, optionally bounded to
   * `appliedAt >= since`. Deliberately NOT paginated or arbitrarily
   * filterable (ADR-072 decision 3 — this is explicitly not a digest
   * feature) — `since` exists only so an operator-facing "recently"
   * (#3168's `AutoAppliedNote`) has an actual window to bound itself to,
   * rather than reading every automatic change the install has EVER made.
   *
   * **Retention (#3161 review): there is none.** No migration prunes this
   * table and nothing else in the tree deletes from it — a `since` window
   * on the READ is the only thing standing between "any automatic change
   * ever" and "recent". A future retention sweep (mirroring
   * `DemoAccountCleanupService`'s row-deletion precedent) is a deliberate,
   * separate follow-up.
   */
  findRecent(limit: number, since?: Date): Promise<readonly PriceChangeAutoAppliedLogEntry[]>;
}
