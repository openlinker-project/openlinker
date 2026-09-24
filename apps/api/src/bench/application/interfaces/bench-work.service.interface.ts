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
  /**
   * `supervises` carries the same meaning as on `listBenchWork`, and for the
   * same reason: this method picks its candidate FROM that list, so the two
   * must be scoped alike or the button reaches work the screen does not show.
   */
  claimNext(viewerId: string, supervises: boolean): Promise<BenchClaimNextResultView>;

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

/**
 * `claimNext` must take the SAME filter arguments as `listBenchWork` (ADR-074,
 * #3439 review).
 *
 * `claimNext` picks its candidate from `listBenchWork`'s own result, so a
 * filter added to one and not the other lets the button reach work the screen
 * does not show — a parcel appearing on a packer's bench with no row on their
 * rail to explain where it came from. The rule was stated in prose in two
 * places and *had already been got wrong once*, which is the argument for a
 * guard rather than a third sentence.
 *
 * A type-level assertion rather than a test, because the failure it catches is
 * a SIGNATURE divergence and that is exactly what a compiler sees: mutual
 * assignability collapses to `never` the moment either parameter list gains a
 * member the other lacks, and the `true` assignment below stops compiling.
 *
 * It cannot see a body that takes both arguments and forwards a literal (the
 * shape of the original defect) — `bench-work.service.spec.ts` pins that half.
 */
type SameFilterArguments<A extends unknown[], B extends unknown[]> = A extends B
  ? B extends A
    ? true
    : never
  : never;

const _claimNextTakesTheSameFilterAsListBenchWork: SameFilterArguments<
  Parameters<IBenchWorkService['listBenchWork']>,
  Parameters<IBenchWorkService['claimNext']>
> = true;
void _claimNextTakesTheSameFilterAsListBenchWork;
