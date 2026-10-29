/**
 * Fulfillment Order Cancellation Service Interface (#3540)
 *
 * The seam a sibling context uses to ask "is any fulfilment work on this order
 * already underway?" and to retire that work when the order is cancelled. Exists
 * because `FulfillmentWorkRepositoryPort` may not cross a context boundary.
 *
 * @module libs/core/src/fulfillment/application/interfaces
 */
import type { FulfillmentRequestStatus } from '../../domain/types/fulfillment-request-status.types';
import type { FulfillmentWorkStatus } from '../../domain/types/fulfillment-work-status.types';

/** The slice of a work object an order-level cancel decision needs. */
export interface OrderCancellationWorkSummary {
  readonly workId: string;
  readonly status: FulfillmentWorkStatus;
  readonly requestStatus: FulfillmentRequestStatus;
  readonly assignedConnectionId: string | null;
}

export interface OrderWorkCancellationResult {
  /** Works moved to `cancelled` with reason `order_cancelled`. */
  readonly cancelledWorkIds: readonly string[];
  /** Works left as they were because they had already come to rest (terminal) or a peer moved them first. */
  readonly skippedWorkIds: readonly string[];
}

export interface IFulfillmentOrderCancellationService {
  /** Every work object covering the order, terminal ones included. Empty for an unrouted order. */
  summarizeForOrder(orderId: string): Promise<readonly OrderCancellationWorkSummary[]>;

  /**
   * Cancel every non-terminal work object on the order with the reason
   * `order_cancelled`.
   *
   * Idempotent: a terminal work is skipped, never re-stamped. It does NOT ask an
   * accepting external holder to give the work back - that is a negotiation the
   * holder may refuse (ADR-054), and the operator's acknowledgement of accepted
   * work is what the soft gate upstream records.
   */
  cancelAllForOrder(orderId: string, cancelledAt: Date): Promise<OrderWorkCancellationResult>;
}
