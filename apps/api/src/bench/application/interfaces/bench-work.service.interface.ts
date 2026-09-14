/**
 * Pack-bench work-list service — interface (#2416, `W3b-3`, spec § 2.2)
 *
 * @module apps/api/src/bench/application/interfaces
 */
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
   */
  listBenchWork(): Promise<BenchWorkListView>;
}
