/**
 * Mirakl Fulfillment Readback
 *
 * The `OrderFulfillmentReadback` half of the Mirakl order source (#4276): what
 * the operator says about an order's shipment, read from OR11. A shipment the
 * seller entered in the operator's panel shows up here, carrier and tracking
 * number included, because Mirakl keeps them on the order itself
 * (`shipping_tracking`, `shipping_carrier_code`, `shipping_company`). The same
 * read answers both halves, so unlike Allegro there is no second request.
 *
 * Never throws for a marketplace condition: a failed read is `unavailable`.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 * @implements {OrderFulfillmentReadback}
 */
import {
  unavailableSourceFulfillmentReadback,
  type OrderFulfillmentReadback,
  type SourceFulfillmentReadback,
} from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';
import { MiraklApiException } from '../../domain/exceptions/mirakl-api.exception';
import { isDispatchedOrderState } from '../../domain/policies/mirakl-order-state.policy';
import type { IMiraklHttpClient } from '../http/mirakl-http-client.interface';
import { describeMiraklFailure, readMiraklOrder } from './mirakl-order-reader';

export class MiraklFulfillmentReadback implements OrderFulfillmentReadback {
  private readonly logger = new Logger(MiraklFulfillmentReadback.name);

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IMiraklHttpClient,
    private readonly brand: string
  ) {}

  async readFulfillment(input: { externalOrderId: string }): Promise<SourceFulfillmentReadback> {
    try {
      const order = await readMiraklOrder(this.httpClient, input.externalOrderId);
      if (!order) {
        return unavailableSourceFulfillmentReadback(
          `Order ${input.externalOrderId} was not found on ${this.brand}`
        );
      }
      const tracking = order.shipping_tracking?.trim();
      return {
        outcome: 'read',
        rawStatus: order.order_state ?? null,
        dispatched: isDispatchedOrderState(order.order_state),
        waybills: tracking
          ? [
              {
                waybill: tracking,
                ...(order.shipping_carrier_code && { carrierId: order.shipping_carrier_code }),
                ...(order.shipping_company && { carrierName: order.shipping_company }),
              },
            ]
          : [],
      };
    } catch (error) {
      const reason =
        error instanceof MiraklApiException
          ? describeMiraklFailure(error.statusCode, error.miraklCode)
          : (error as Error)?.name ?? 'error';
      this.logger.warn(
        `Fulfilment readback for order ${input.externalOrderId} on connection ${this.connectionId} failed: ${reason}`
      );
      return unavailableSourceFulfillmentReadback(`${this.brand} could not be read: ${reason}`);
    }
  }
}
