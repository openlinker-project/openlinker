/**
 * Order Cancellation Service Interface (#3540)
 *
 * @module apps/api/src/orders/application/interfaces
 */
import type {
  CancelOrderInput,
  CancelOrderResult,
  ConfirmOrderChangeInput,
  ConfirmOrderChangeResult,
} from '../types/order-cancellation.types';

export const ORDER_CANCELLATION_SERVICE_TOKEN = Symbol('IOrderCancellationService');

export interface IOrderCancellationService {
  /**
   * Cancel an order at the operator's request: an ADR-044 proposal the source
   * disposes of. Throws {@link OrderCancellationRefusedError} (a 409 with a
   * machine code) for every modelled refusal, and
   * {@link OrderCancellationNotFoundError} when the order does not exist. A
   * channel whose answer is UNKNOWN is not an error: the result is `pending`
   * and the request stays open.
   */
  cancelOrder(input: CancelOrderInput): Promise<CancelOrderResult>;

  /**
   * Confirm a proposed change the operator has reviewed. Today the only
   * confirmable kind is the credit proposal a cancelled, invoiced order leaves
   * behind (`order.cancel_correction`); the method switches over the kind so
   * the next correction kind is one more arm.
   */
  confirmChange(input: ConfirmOrderChangeInput): Promise<ConfirmOrderChangeResult>;
}
