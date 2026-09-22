/**
 * Pack-bench work-list service — interface (#2416, `W3b-3`, spec § 2.2)
 *
 * @module apps/api/src/bench/application/interfaces
 */
import type { BenchClaimNextResultView } from '../types/bench-parcel.types';
import type { BenchWorkListView } from '../types/bench-work.types';

export const BENCH_WORK_SERVICE_TOKEN = Symbol('IBenchWorkService');

export interface IBenchWorkService {
  /**
   * Everything routed to OpenLinker's own packing executor and accepted there,
   * urgency first.
   *
   * Takes NO filter. The scope is a property of the bench, not a request
   * parameter: a packer must not be able to widen the read to another
   * executor's work by editing a query string, and there is nothing on this
   * surface a narrower one would serve — the search field filters rows the
   * browser already holds.
   *
   * `viewerId` (#3341, ADR-074) is the authenticated caller's own user id,
   * never optional — it is what each row's `assignmentState` / `claimable`
   * is computed against.
   */
  listBenchWork(viewerId: string): Promise<BenchWorkListView>;

  /**
   * "Take next task" (#3412) — picks the TOP eligible row from the
   * already-sorted, already-eligibility-filtered worklist this viewer would
   * see, and claims it. No new domain rule: sort order and eligibility are
   * both already computed by `listBenchWork` / `compareBenchWork`, so this
   * is a thin wrapper rather than a second ordering to keep in sync.
   */
  claimNext(viewerId: string): Promise<BenchClaimNextResultView>;
}
