/**
 * Source Fulfillment Status Service Interface
 *
 * @module apps/api/src/orders/application/interfaces
 */
import type { SourceFulfillmentStatusView } from '../types/source-fulfillment-status.types';

export const SOURCE_FULFILLMENT_STATUS_SERVICE_TOKEN = Symbol('ISourceFulfillmentStatusService');

export interface ISourceFulfillmentStatusService {
  /**
   * Ask the order's SOURCE marketplace what it currently says about the
   * order's fulfilment.
   *
   * Never throws for a marketplace-side condition - an unreachable source, a
   * source with no readback, and an order with no external id are all states
   * on the returned view. Throws only when the order itself does not exist,
   * which is the caller's 404.
   */
  read(internalOrderId: string): Promise<SourceFulfillmentStatusView>;
}
