/**
 * Cost Coverage Service Interface
 *
 * Contract for the reads behind the "Missing cost prices" screens (#3588,
 * D27): the coverage figures of a window, the cost work list and the cheap
 * catalogue-wide summary. Lives in `orders` because every figure is derived
 * from the per-line snapshot population (`products` must not import `orders`);
 * it takes `includeBackfilledPreRollout` as a plain parameter exactly like the
 * margin reads.
 *
 * @module libs/core/src/orders/application/services
 */
import type {
  CostCoverageResult,
  CostSummary,
  CostWorklistCountFilters,
  CostWorklistFilters,
  CostWorklistResult,
} from '../../domain/types/cost-coverage.types';

export interface ICostCoverageService {
  /** Coverage of the last `days` UTC days (today included); `now` is injectable for tests. */
  getCostCoverage(
    days: number,
    includeBackfilledPreRollout?: boolean,
    now?: Date
  ): Promise<CostCoverageResult>;

  /**
   * One page of the work list. `withTotal: false` skips the COUNT and the
   * result then carries no `total` (never a 0).
   */
  getWorklist(
    filters: CostWorklistFilters,
    options?: { withTotal?: boolean; includeBackfilledPreRollout?: boolean; now?: Date }
  ): Promise<CostWorklistResult>;

  /** The total of {@link getWorklist} for the same filters, no paging. */
  countWorklist(
    filters: CostWorklistCountFilters,
    includeBackfilledPreRollout?: boolean,
    now?: Date
  ): Promise<number>;

  /** Variants / products without a cost, and variants with one (no date window). */
  getSummary(): Promise<CostSummary>;
}
