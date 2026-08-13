/**
 * Coverage Gap Read Service Interface
 *
 * Defines the contract for the coverage-gaps "needs attention" aggregate
 * (#1983) — variants listed on one listing-capable connection but missing
 * from another.
 *
 * @module libs/core/src/listings/application/services
 */
import type { CoverageGapsResult } from '../../domain/types/coverage-gap.types';

export interface ICoverageGapReadService {
  /**
   * Find variants that are listed on at least one, but not every,
   * listing-capable (`OfferManager` or `ProductPublisher`) active connection.
   * Excludes `isStale` (#1689) variants. Bounded to `limit` items, sorted by
   * widest gap (most missing connections) first.
   */
  findCoverageGaps(limit: number): Promise<CoverageGapsResult>;
}
