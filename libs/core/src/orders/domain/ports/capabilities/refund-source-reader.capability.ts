/**
 * Refund Source Reader Capability
 *
 * Read-only observation of the payment refunds a source channel made on an
 * order it sold - a sub-capability of `OrderSourcePort`. A refund performed on
 * the channel (a seller pressing "refund payment" in the marketplace panel) is
 * invisible to the order read itself, and `RefundExecutor` is the opposite
 * direction (OL asking a destination to move money). This is the half that lets
 * OL record what the channel already did, without executing anything.
 *
 * Implementations must return only SETTLED refunds. A pending or failed refund
 * moved no money, and recording it would put a figure in the books that the
 * buyer never received.
 *
 * Probed, never trusted (ADR-046) and advertised-without-dispatch like the
 * rest of the `OrderSource` sub-capability family: narrow the dispatched
 * `OrderSource` adapter with {@link isRefundSourceReader}; never resolve it by
 * name through the registry.
 *
 * @module libs/core/src/orders/domain/ports/capabilities
 * @see docs/architecture/adrs/056-refund-and-fiscal-authority-never-leave-ol.md
 */
import type { SourceRefundObservation } from '../../types/source-refund-observation.types';

export interface RefundSourceReader {
  /** List the settled refunds the channel holds for one order. */
  listRefunds(input: { externalOrderId: string }): Promise<SourceRefundObservation[]>;
}

export function isRefundSourceReader<T extends object>(
  adapter: T
): adapter is T & RefundSourceReader {
  return typeof (adapter as Partial<RefundSourceReader>).listRefunds === 'function';
}
