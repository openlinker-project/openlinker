/**
 * Pack-bench work-list service — interface (#2416, `W3b-3`, spec § 2.2)
 *
 * @module apps/api/src/bench/application/interfaces
 */
import type { BenchClaimNextResultView } from '../types/bench-parcel.types';
import type {
  BenchMetricsView,
  BenchPackedTodayListView,
  BenchWorkListView,
} from '../types/bench-work.types';

export const BENCH_WORK_SERVICE_TOKEN = Symbol('IBenchWorkService');

export interface IBenchWorkService {
  /**
   * Everything routed to OpenLinker's own packing executor and accepted there,
   * urgency first.
   *
   * Takes NO filter that a caller could edit. The scope is a property of the
   * bench, not a request parameter: a packer must not be able to widen the
   * read to another executor's work by editing a query string, and there is
   * nothing on this surface a narrower one would serve — the search field
   * filters rows the browser already holds.
   *
   * `viewerId` (#3341, ADR-074) is the authenticated caller's own user id,
   * never optional — it is what each row's `assignmentState` / `claimable`
   * is computed against.
   *
   * `supervises` (#3340, ADR-071) says whether this caller may see work
   * currently assigned to SOMEBODY ELSE — true for an admin or operator, who
   * use the bench to supervise or cover a shift, false for a packer, who sees
   * only their own work and the unassigned pool. **Required, not
   * optional-with-default**: a caller that forgot to pass it would silently
   * widen the read, and widening is the wrong failure direction for a scope
   * that exists to hide another packer's parcels (and the buyer name each one
   * carries). It MUST be derived from the authenticated principal's own
   * permissions, never from a request parameter — exactly like `viewerId`
   * above, a packer must not be able to flip this by editing the request; the
   * caller resolves it from `@CurrentUser()`, not from a query string or body.
   */
  listBenchWork(viewerId: string, supervises: boolean): Promise<BenchWorkListView>;

  /**
   * "Take next task" (#3412) — picks the TOP eligible row from the
   * already-sorted, already-eligibility-filtered worklist this viewer would
   * see, and claims it. No new domain rule: sort order and eligibility are
   * both already computed by `listBenchWork` / `compareBenchWork`, so this
   * is a thin wrapper rather than a second ordering to keep in sync.
   */
  claimNext(viewerId: string): Promise<BenchClaimNextResultView>;

  /**
   * Parcels THIS bench closed today, newest-closed first (#3413).
   *
   * `dayStart`/`dayEnd` are the caller's own half-open day boundary — this
   * layer decides no timezone, exactly as `listBenchWork` decides no
   * location.
   */
  listPackedToday(dayStart: Date, dayEnd: Date): Promise<BenchPackedTodayListView>;

  /**
   * The bench's metric row (#3413): packed-today, packed at the same
   * elapsed point yesterday (the trend), and the outstanding backlog
   * across every connection routed to OpenLinker's own packing executor.
   *
   * `now` is the caller's own clock, threaded in rather than read here —
   * this layer takes no dependency on the system clock so a test can pin
   * every boundary.
   */
  getMetrics(now: Date): Promise<BenchMetricsView>;
}
