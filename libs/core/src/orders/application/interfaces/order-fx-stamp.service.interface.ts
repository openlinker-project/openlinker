/**
 * Order FX Stamp Service Interface
 *
 * The single seam every FX stamp attempt goes through (#2125, ADR-040) - the
 * inline ingestion call, the `marketplace.order.fxStamp` retry job and the
 * hourly `marketplace.order.fxStampSweep` reconcile all reach the stamp here.
 *
 * @module libs/core/src/orders/application/interfaces
 */
import type {
  FxStampOutcome,
  OrderFxSweepOptions,
  OrderFxSweepResult,
} from '../../domain/types/order-fx-stamp.types';

export interface IOrderFxStampService {
  /**
   * Stamp one order's reporting-currency figure, at most once.
   *
   * ONE SIGNATURE FOR EVERY CALLER, and deliberately just the id: the retry
   * handler never has anything else, and `placedAt` lives only inside
   * `orderSnapshot` JSONB where an unparseable value is silently dropped. Two
   * signatures would let the inline and retry paths legitimately disagree about
   * whether `placedAt` exists - i.e. make provider availability an input to a
   * financial figure. Both rehydrate from the persisted record; the inline
   * caller pays one extra read for that.
   *
   * NEVER THROWS. Every failure is folded into the returned outcome: a stamp
   * must not be able to fail an ingestion that has already persisted the order.
   */
  stamp(internalOrderId: string): Promise<FxStampOutcome>;

  /**
   * Re-attempt one bounded page of a source connection's unstamped orders.
   *
   * The guarantee that survives a dead retry job: a job's idempotency key is
   * globally unique with no TTL, so once its ten attempts are exhausted that
   * key can never be re-enqueued and the order would go unstamped forever.
   * Reading the unstamped rows directly is the only mechanism that also covers
   * a retry job that was never enqueued at all.
   */
  sweep(sourceConnectionId: string, options: OrderFxSweepOptions): Promise<OrderFxSweepResult>;
}
