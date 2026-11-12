/**
 * Shopify Order Status Writeback
 *
 * `OrderStatusWriteback` for a Shopify order: the lifecycle relay asks every
 * participant of an order through its own adapter, and the SOURCE is one of
 * them (L-S3c: without a writeback on the order source, a dispatch made in
 * OpenLinker never reaches the shop the order came from). One class, so the
 * order source (#3977) and the order processor (#3978) write the same way.
 *
 *   - `dispatched`: `fulfillmentCreate` on every fulfillment order still open
 *     at the configured location, with tracking number, carrier and URL
 *     (`buildShopifyTrackingInfo`, L-F3). Shopify routes an order it took
 *     itself, often to the location that had stock; OpenLinker is the single
 *     warehouse and the parcel left it, so open fulfillment orders assigned
 *     elsewhere are first moved to the configured location (C24). An order
 *     already fulfilled answers `applied` (the same event delivered twice).
 *   - `cancelled`: `orderCancel` keeping the payment (`refund: false`) and
 *     restocking; an order already cancelled answers `applied`. The cancel
 *     runs as an async job on Shopify, so it is accepted, not yet visible.
 *   - `delivered` and `in-progress`: `unsupported` - Shopify has fulfillment
 *     events for both, but they are not verified on a live store yet, and a
 *     platform that cannot show a state declines it rather than guessing.
 *
 * A refusal Shopify states (`userErrors`) is `rejected`; a throttle and every
 * transport failure throw, so the relay retries.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/order-status
 * @implements {OrderStatusWriteback}
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type {
  OrderLifecycleEvent,
  OrderStatusWriteback,
  OrderWritebackResult,
} from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

import { ShopifyOrderNotFoundException } from '../../../domain/exceptions/shopify-order-not-found.exception';
import { ShopifyUserErrorsException } from '../../../domain/exceptions/shopify-user-errors.exception';
import { fromShopifyGid, toShopifyGid } from '../../../domain/policies/shopify-gid.policy';
import type { ShopifyConnection, ShopifyFulfillmentOrder } from '../../../domain/types/shopify-api.types';
import type { ShopifyGraphqlClient } from '../../http/shopify-graphql-client';
import { buildShopifyTrackingInfo } from '../../mappers/shopify-tracking.mapper';
import {
  FULFILLMENT_CREATE_MUTATION,
  FULFILLMENT_ORDER_MOVE_MUTATION,
  ORDER_CANCEL_MUTATION,
  ORDER_FULFILLMENT_ORDERS_QUERY,
} from '../../readers/shopify-order.queries';
import type { ShopifyShopContextProvider } from '../../shop-context/shopify-shop-context.provider';

/** Fulfillment-order states a fulfillment can still be created on. */
const FULFILLABLE_STATUSES: ReadonlySet<string> = new Set(['OPEN', 'IN_PROGRESS']);

interface FulfillmentOrdersQuery {
  readonly order: {
    readonly id: string;
    readonly displayFulfillmentStatus: string;
    readonly cancelledAt: string | null;
    readonly fulfillmentOrders: ShopifyConnection<ShopifyFulfillmentOrder>;
  } | null;
}

type OrderFulfillmentOrders = NonNullable<FulfillmentOrdersQuery['order']>;

function hasOpenWork(fo: ShopifyFulfillmentOrder): boolean {
  return FULFILLABLE_STATUSES.has(fo.status) && (fo.lineItems?.nodes ?? []).some((l) => l.remainingQuantity > 0);
}

export class ShopifyOrderStatusWriteback implements OrderStatusWriteback {
  private readonly logger = new Logger(ShopifyOrderStatusWriteback.name);

  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly shopContext: ShopifyShopContextProvider,
    private readonly connection: Connection,
  ) {}

  async write(event: OrderLifecycleEvent): Promise<OrderWritebackResult> {
    switch (event.type) {
      case 'dispatched':
        return this.fulfil(event.externalOrderId, event.trackingNumber, event.carrier?.platformType);
      case 'cancelled':
        return this.cancel(event.externalOrderId);
      default:
        return { outcome: 'unsupported', detail: `Shopify writeback does not handle "${event.type}"` };
    }
  }

  private async fulfil(
    externalOrderId: string,
    trackingNumber: string | undefined,
    carrierPlatformType: string | undefined,
  ): Promise<OrderWritebackResult> {
    let order = await this.readFulfillmentOrders(externalOrderId);
    const { locationGid } = await this.shopContext.get();
    const elsewhere = order.fulfillmentOrders.nodes.filter(
      (fo) => hasOpenWork(fo) && fo.assignedLocation?.location?.id !== locationGid,
    );
    if (elsewhere.length > 0) {
      await this.moveToLocation(externalOrderId, elsewhere, locationGid);
      order = await this.readFulfillmentOrders(externalOrderId);
    }
    const open = order.fulfillmentOrders.nodes.filter(
      (fo) => hasOpenWork(fo) && fo.assignedLocation?.location?.id === locationGid,
    );
    if (open.length === 0) {
      if (order.displayFulfillmentStatus === 'FULFILLED') {
        return { outcome: 'applied', detail: 'already fulfilled on Shopify' };
      }
      return { outcome: 'rejected', detail: `no open fulfillment order at the configured location ${locationGid}` };
    }

    const tracking =
      trackingNumber === undefined || trackingNumber.trim().length === 0
        ? null
        : buildShopifyTrackingInfo(trackingNumber, carrierPlatformType);
    try {
      await this.client.mutate(
        FULFILLMENT_CREATE_MUTATION,
        {
          fulfillment: {
            lineItemsByFulfillmentOrder: open.map((fo) => ({ fulfillmentOrderId: fo.id })),
            ...(tracking === null ? {} : { trackingInfo: tracking }),
            notifyCustomer: false,
          },
        },
        'fulfillmentCreate',
      );
    } catch (error) {
      if (error instanceof ShopifyUserErrorsException && !error.isRateLimited()) {
        return { outcome: 'rejected', detail: error.message };
      }
      throw error;
    }
    return { outcome: 'applied' };
  }

  /** Moves open work to the configured location; a failed move is logged and the fulfil reports it. */
  private async moveToLocation(
    orderId: string,
    fulfillmentOrders: readonly ShopifyFulfillmentOrder[],
    locationGid: string,
  ): Promise<void> {
    for (const fo of fulfillmentOrders) {
      const assigned = fo.assignedLocation?.location?.id ?? 'no location';
      try {
        await this.client.mutate(
          FULFILLMENT_ORDER_MOVE_MUTATION,
          { id: fo.id, locationId: locationGid },
          'fulfillmentOrderMove',
        );
        this.logger.log(
          `Shopify order ${orderId}: fulfillment order ${fromShopifyGid(fo.id)} moved from ${assigned} ` +
            `to ${locationGid} (connection: ${this.connection.id})`,
        );
      } catch (error) {
        if (!(error instanceof ShopifyUserErrorsException) || error.isRateLimited()) {
          throw error;
        }
        this.logger.warn(
          `Shopify order ${orderId}: could not move fulfillment order ${fromShopifyGid(fo.id)} to ` +
            `${locationGid}; it stays at ${assigned}: ${error.message} (connection: ${this.connection.id})`,
        );
      }
    }
  }

  private async cancel(externalOrderId: string): Promise<OrderWritebackResult> {
    const order = await this.readFulfillmentOrders(externalOrderId);
    if (order.cancelledAt !== null) {
      return { outcome: 'applied', detail: 'already cancelled on Shopify' };
    }
    try {
      await this.client.mutate(
        ORDER_CANCEL_MUTATION,
        { id: toShopifyGid('Order', externalOrderId) },
        'orderCancel',
        'orderCancelUserErrors',
      );
    } catch (error) {
      if (error instanceof ShopifyUserErrorsException && !error.isRateLimited()) {
        return { outcome: 'rejected', detail: error.message };
      }
      throw error;
    }
    return { outcome: 'applied' };
  }

  private async readFulfillmentOrders(externalOrderId: string): Promise<OrderFulfillmentOrders> {
    const data = await this.client.query<FulfillmentOrdersQuery>(ORDER_FULFILLMENT_ORDERS_QUERY, {
      id: toShopifyGid('Order', externalOrderId),
    });
    if (data.order === null) {
      throw new ShopifyOrderNotFoundException(externalOrderId, this.connection.id);
    }
    return data.order;
  }
}
