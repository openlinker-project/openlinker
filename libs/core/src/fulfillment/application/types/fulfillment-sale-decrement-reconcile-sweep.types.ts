/**
 * Sale-Decrement Reconcile Sweep - the I/O shapes (#3629)
 *
 * @module libs/core/src/fulfillment/application/types
 */
import type { SaleDecrementEnqueueIntent } from '../../domain/types/fulfillment-sale-decrement-enqueue.types';

export interface ListWorksMissingSaleDecrementJobInput {
  /** Candidates examined this run. Clamped by the caller. */
  readonly limit: number;
  /** `resolveSaleDecrementReconcileGraceMs` - a work younger than this is left alone. */
  readonly graceMs: number;
  /** `resolveSaleDecrementReconcileLookbackMs` - a work older than this is no longer a candidate. */
  readonly lookbackMs: number;
  /** The run's instant, supplied so the cutoff is testable. */
  readonly now: Date;
}

export interface ListWorksMissingSaleDecrementJobResult {
  /**
   * The intent the two routing hosts already build, so the sweep enqueues under
   * the SAME idempotency key the producers use: a race with a slow original
   * enqueue is then a harmless `isExisting`.
   */
  readonly candidates: readonly SaleDecrementEnqueueIntent[];
}
