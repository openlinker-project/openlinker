/**
 * Mirakl Order Status Writer
 *
 * The `OrderStatusWriteback` half of the Mirakl order source (#4276): tells the
 * operator that an order OpenLinker handled has shipped or been cancelled.
 *
 * - **`dispatched`**: OR23 (`PUT /api/orders/{id}/tracking`) with the tracking
 *   number, then OR24 (`PUT /api/orders/{id}/ship`). Mirakl keeps ONE tracking
 *   number per order: a second parcel's number is logged and not sent, since
 *   OR23 would overwrite the first. Without a tracking number only OR24 runs.
 *   An order closed without tracking auto-closes as received after 10 days on
 *   Empik, so the number matters.
 * - **`cancelled`**: OR29 (`PUT /api/orders/{id}/cancel`), the whole order.
 *   Core only ever cancels whole orders; OR30 (line cancellation, with an
 *   operator reason code) has no caller.
 * - **`delivered`, `in-progress`, `paid`**: `unsupported`. Mirakl's buyer or
 *   carrier moves an order to `RECEIVED`, and payment is the operator's.
 *
 * Every write reads the order first (OR11), which makes it idempotent: an
 * order already shipped or cancelled is `applied` without another call, and a
 * replayed tracking number is not resent.
 *
 * A Mirakl refusal (`MiraklApiException`) is `rejected` with its status and
 * code; OR23 and OR24 refusals carry no code, so the status is all there is.
 * Transport, auth and throttling failures are thrown: the relay treats a throw
 * as an unknown outcome and the retry ladder owns it.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 * @implements {OrderStatusWriteback}
 */
import type {
  OrderLifecycleEvent,
  OrderStatusWriteback,
  OrderWritebackResult,
} from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';
import { MiraklApiException } from '../../domain/exceptions/mirakl-api.exception';
import { buildMiraklTrackingBody } from '../../domain/policies/mirakl-carrier.policy';
import {
  CANCELLED_ORDER_STATES,
  DISPATCHED_ORDER_STATES,
  READY_TO_SHIP_ORDER_STATE,
} from '../../domain/policies/mirakl-order-state.policy';
import type { MiraklOrder } from '../../domain/types/mirakl-order.types';
import type { IMiraklHttpClient } from '../http/mirakl-http-client.interface';
import { describeMiraklFailure, miraklOrderPath, readMiraklOrder } from './mirakl-order-reader';

type DispatchedEvent = Extract<OrderLifecycleEvent, { type: 'dispatched' }>;

export class MiraklOrderStatusWriter implements OrderStatusWriteback {
  private readonly logger = new Logger(MiraklOrderStatusWriter.name);

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IMiraklHttpClient,
    private readonly brand: string,
    private readonly carrierCodes: Readonly<Record<string, string>>
  ) {}

  async write(event: OrderLifecycleEvent): Promise<OrderWritebackResult> {
    switch (event.type) {
      case 'dispatched':
        return this.guarded(event.externalOrderId, (order) => this.dispatch(order, event));
      case 'cancelled':
        return this.guarded(event.externalOrderId, (order) => this.cancel(order));
      case 'delivered':
        return {
          outcome: 'unsupported',
          detail: `${this.brand} marks an order received itself; there is no seller call for it`,
        };
      case 'in-progress':
        return {
          outcome: 'unsupported',
          detail: `${this.brand} has no in-progress state an accepted order can be moved to`,
        };
      case 'paid':
        return {
          outcome: 'unsupported',
          detail: `${this.brand} collects payment itself; a seller cannot mark an order paid`,
        };
      default: {
        const unknown: never = event;
        return {
          outcome: 'unsupported',
          detail: `Unknown lifecycle event ${(unknown as { type?: string }).type ?? ''}`,
        };
      }
    }
  }

  private async guarded(
    orderId: string,
    action: (order: MiraklOrder) => Promise<OrderWritebackResult>
  ): Promise<OrderWritebackResult> {
    try {
      const order = await readMiraklOrder(this.httpClient, orderId);
      if (!order) {
        return { outcome: 'rejected', detail: `Order ${orderId} was not found on ${this.brand}` };
      }
      return await action(order);
    } catch (error) {
      if (error instanceof MiraklApiException) {
        return {
          outcome: 'rejected',
          detail: `${this.brand} refused the update for order ${orderId}: ${describeMiraklFailure(
            error.statusCode,
            error.miraklCode
          )}`,
        };
      }
      throw error;
    }
  }

  private async dispatch(
    order: MiraklOrder,
    event: DispatchedEvent
  ): Promise<OrderWritebackResult> {
    const orderId = event.externalOrderId;
    const state = order.order_state ?? '';
    if (CANCELLED_ORDER_STATES.includes(state)) {
      return { outcome: 'rejected', detail: `Order ${orderId} is ${state} on ${this.brand}` };
    }
    const shipped = DISPATCHED_ORDER_STATES.includes(state);
    if (!shipped && state !== READY_TO_SHIP_ORDER_STATE) {
      return {
        outcome: 'rejected',
        detail: `Order ${orderId} is ${state || 'in an unknown state'} on ${this.brand} and cannot be shipped yet`,
      };
    }

    if (event.trackingNumber) {
      await this.sendTracking(order, event.trackingNumber, event.carrier?.platformType);
    }
    if (!shipped) {
      await this.httpClient.put(miraklOrderPath(orderId, 'ship'));
    }
    return { outcome: 'applied' };
  }

  private async sendTracking(
    order: MiraklOrder,
    trackingNumber: string,
    platformType: string | undefined
  ): Promise<void> {
    const orderId = order.order_id ?? '';
    const existing = order.shipping_tracking?.trim();
    if (existing === trackingNumber.trim()) {
      return;
    }
    if (existing) {
      // One tracking number per order on Mirakl; OR23 would replace the first.
      this.logger.warn(
        `Order ${orderId} on connection ${this.connectionId} already has a tracking number; ` +
          `a further parcel's number was not sent to ${this.brand}`
      );
      return;
    }
    await this.httpClient.put(
      miraklOrderPath(orderId, 'tracking'),
      buildMiraklTrackingBody(trackingNumber, {
        platformType,
        shippingTypeCode: order.shipping_type_code,
        overrides: this.carrierCodes,
      })
    );
  }

  private async cancel(order: MiraklOrder): Promise<OrderWritebackResult> {
    const orderId = order.order_id ?? '';
    const state = order.order_state ?? '';
    if (CANCELLED_ORDER_STATES.includes(state)) {
      return { outcome: 'applied' };
    }
    if (DISPATCHED_ORDER_STATES.includes(state)) {
      return {
        outcome: 'rejected',
        detail: `Order ${orderId} has already shipped on ${this.brand}; it can only be refunded there`,
      };
    }
    await this.httpClient.put(miraklOrderPath(orderId, 'cancel'));
    return { outcome: 'applied' };
  }
}
