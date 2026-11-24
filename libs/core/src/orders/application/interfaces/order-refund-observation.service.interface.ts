/**
 * Order Refund Observation Service Interface
 *
 * @module application/interfaces
 */
export interface RefundObservationResult {
  /** Settled refunds the channel reported. */
  observed: number;
  /** New refund records written. */
  recorded: number;
  /** Refunds already recorded by an earlier observation (idempotent no-ops). */
  alreadyRecorded: number;
  /** Refunds that could not be recorded (currency mismatch, precision), logged. */
  rejected: number;
}

export interface IOrderRefundObservationService {
  /**
   * Record the refunds a source channel made on an order, once each.
   * Best-effort and bounded: one channel read, only for a paid order that
   * originated on this connection, and a no-op for a source that cannot report.
   */
  observeSourceRefunds(
    connectionId: string,
    externalOrderId: string
  ): Promise<RefundObservationResult>;
}
