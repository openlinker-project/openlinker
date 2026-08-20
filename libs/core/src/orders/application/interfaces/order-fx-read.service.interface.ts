/**
 * Order FX Read Service Interface
 *
 * The cross-context read seam for the two order-side facts the
 * reporting-currency settings surface needs: which native currencies this
 * deployment has actually ingested, and how much history already carries a
 * stamp.
 *
 * It exists as its own narrow interface rather than as two more methods on
 * `IOrderRecordService` because both reads are whole-table aggregates with no
 * order identity - nothing on the per-order record path wants them - and
 * because a sibling context may only reach `orders` through an `I*Service`,
 * never through `OrderRecordRepositoryPort`.
 *
 * @module libs/core/src/orders/application/interfaces
 */
import type { StampedReportingCurrencyCount } from '../../domain/types/order-fx-read.types';

export interface IOrderFxReadService {
  /**
   * The distinct set of order-native currencies already ingested - the input to
   * the reporting-currency coverage advisory.
   */
  listDistinctNativeCurrencies(): Promise<string[]>;

  /**
   * Stamped-row counts per reporting currency. An empty array means nothing is
   * stamped yet, which is the "this choice costs nothing" case.
   */
  countStampedByReportingCurrency(): Promise<StampedReportingCurrencyCount[]>;
}
