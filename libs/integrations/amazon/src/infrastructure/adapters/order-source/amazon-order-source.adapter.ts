/**
 * Amazon Order Source Adapter
 *
 * `OrderSource` for Amazon (#4178): the order feed over Orders API v2026-01-01
 * `searchOrders`, the order read over `getOrder`, the tracking write-back over
 * v0 `confirmShipment`, and the option lists the mapping UI offers.
 *
 * Feed: `lastUpdatedAfter` watermark plus Amazon's pagination token, held in
 * the opaque cursor (`amazon-order-feed-cursor.policy.ts`). One call per page;
 * `searchOrders` allows 0.0056 req/s, burst 20, and the poll task paces itself
 * accordingly. A feed item is keyed by order id and `lastUpdatedTime`, so a
 * re-read of the same version dedups downstream while a new update does not.
 *
 * Write-back (`OrderStatusWriteback`):
 *   - `dispatched` with a tracking number -> `confirmShipment` for every line
 *     of the order, with Amazon's carrier code for the label's carrier. An
 *     order Amazon fulfils itself (FBA) is not confirmed by the seller.
 *     Known limit: the event names no lines, so an order sent in several
 *     parcels is confirmed in full with the first one, and Amazon refuses the
 *     next ones.
 *   - `dispatched` without a tracking number is `unsupported`: Amazon requires
 *     one, and the late-waybill relay (#1947) sends the event again once the
 *     carrier mints it.
 *   - `cancelled`, `delivered`, `in-progress`, `paid` are `unsupported`: the
 *     Orders API has no seller call for them.
 *   Never throws; a failure is `rejected`, transient when it was a transport
 *   failure or a throttle.
 *
 * Returns (`ReturnSourceReader`, #4184): delegated to `AmazonReturnReader`,
 * which reads Amazon's seller-fulfilled returns report. Refunds
 * (`RefundExecutor`) are on the refunding subclasses the factory builds only
 * for a connection that opted in, so a connection without the opt-in is not a
 * refund executor at all and core records the refund as done out of band.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/order-source
 * @implements {OrderSourcePort}
 */
import type {
  IncomingOrder,
  MappingOption,
  OrderFeedInput,
  OrderFeedItem,
  OrderFeedOutput,
  OrderLifecycleEvent,
  OrderSourcePort,
  OrderStatusWriteback,
  OrderWritebackResult,
  ReturnSourceReader,
  SourceOptionsReader,
} from '@openlinker/core/orders';
import type { IncomingReturn, ReturnFeedInput, ReturnFeedOutput } from '@openlinker/core/returns';
import { Logger } from '@openlinker/shared/logging';
import { RateLimitAbortedError, RateLimitTimeoutError } from '@openlinker/shared/rate-limit';

import { AmazonConfigException } from '../../../domain/exceptions/amazon-config.exception';
import type { AmazonConnectionConfig } from '../../../domain/types/amazon-config.types';
import {
  decodeAmazonOrderFeedCursor,
  encodeAmazonOrderFeedCursor,
  nextAmazonOrderFeedCursor,
  scopeAmazonOrderFeedCursor,
} from '../../../domain/policies/amazon-order-feed-cursor.policy';
import { amazonPackageReferenceId } from '../../../domain/policies/amazon-package-reference.policy';
import { AmazonApiError } from '../../../domain/exceptions/amazon-api.error';
import { AmazonNetworkError } from '../../../domain/exceptions/amazon-network.error';
import {
  AmazonFulfillmentStatusValues,
  AmazonServiceLevelValues,
  type AmazonConfirmShipmentRequest,
  type AmazonGetOrderResponse,
  type AmazonOrder,
  type AmazonSearchOrdersResponse,
} from '../../../domain/types/amazon-order.types';
import type { AmazonSpApiClient } from '../../http/amazon-spapi-client';
import { mapAmazonOrderToIncomingOrder } from '../../mappers/amazon-incoming-order.mapper';
import { AMAZON_TERMINAL_RETURN_STATUSES } from '../../mappers/amazon-return.mapper';
import type { AmazonReturnReader } from '../returns/amazon-return-reader';
import { resolveAmazonCarrier } from './amazon-carrier-code';

const SEARCH_ORDERS_PATH = '/orders/2026-01-01/orders';
const MAX_RESULTS_PER_PAGE = 100;

/** What `getOrder` asks Amazon to include. `RECIPIENT` needs the D2C Shipping role; without it Amazon omits the address. */
const GET_ORDER_INCLUDED_DATA = ['BUYER', 'RECIPIENT', 'PROCEEDS', 'FULFILLMENT', 'PAYMENT', 'TAX', 'PACKAGES'];

/** Payment method names the Orders API documents (`PaymentExecution.paymentMethod`). */
const DOCUMENTED_PAYMENT_METHODS = ['CashOnDelivery', 'ConvenienceStore', 'CreditCard', 'Invoice', 'Pix'];

export class AmazonOrderSourceAdapter
  implements OrderSourcePort, OrderStatusWriteback, SourceOptionsReader, ReturnSourceReader
{
  private readonly logger = new Logger(AmazonOrderSourceAdapter.name);

  constructor(
    private readonly connectionId: string,
    private readonly client: AmazonSpApiClient,
    private readonly config: AmazonConnectionConfig,
    private readonly now: () => Date = (): Date => new Date(),
    /** The returns report reader (#4184); absent only in tests that do not read returns. */
    protected readonly returns?: AmazonReturnReader,
  ) {}

  /** Return request statuses after which Amazon changes nothing more (#4184). */
  readonly terminalRawStatuses: readonly string[] = AMAZON_TERMINAL_RETURN_STATUSES;

  listReturnFeed(input: ReturnFeedInput): Promise<ReturnFeedOutput> {
    return this.requireReturns().listReturnFeed(input);
  }

  getReturn(input: { externalReturnId: string }): Promise<IncomingReturn> {
    return this.requireReturns().getReturn(input);
  }

  protected requireReturns(): AmazonReturnReader {
    if (this.returns === undefined) {
      throw new AmazonConfigException(this.connectionId, 'the returns report reader is not configured');
    }
    return this.returns;
  }

  async listOrderFeed(input: OrderFeedInput): Promise<OrderFeedOutput> {
    const now = this.now();
    // A marketplace added on the connection page rewinds the watermark for it.
    const cursor = scopeAmazonOrderFeedCursor(
      decodeAmazonOrderFeedCursor(input.fromCursor, now),
      this.config.marketplaceIds,
      now,
    );
    const response = await this.client.get<AmazonSearchOrdersResponse>(SEARCH_ORDERS_PATH, {
      marketplaceIds: this.config.marketplaceIds,
      lastUpdatedAfter: cursor.since,
      maxResultsPerPage: Math.min(Math.max(input.limit, 1), MAX_RESULTS_PER_PAGE),
      ...(cursor.paginationToken ? { paginationToken: cursor.paginationToken } : {}),
    });

    const orders = response.data.orders ?? [];
    const items: OrderFeedItem[] = orders
      .map((order) => toFeedItem(order))
      .filter((item) => input.eventTypes === undefined || input.eventTypes.includes(item.eventType));
    const latestUpdatedOnPage = orders
      .map((order) => order.lastUpdatedTime)
      .filter((value) => !Number.isNaN(Date.parse(value)))
      .sort()
      .at(-1);

    const next = nextAmazonOrderFeedCursor({
      current: cursor,
      nextToken: response.data.pagination?.nextToken,
      windowEnd: response.data.lastUpdatedBefore,
      latestUpdatedOnPage,
      now,
    });
    return { items, nextCursor: encodeAmazonOrderFeedCursor(next) };
  }

  async getOrder(input: { externalOrderId: string }): Promise<IncomingOrder> {
    const order = await this.readOrder(input.externalOrderId);
    return mapAmazonOrderToIncomingOrder(order);
  }

  async write(event: OrderLifecycleEvent): Promise<OrderWritebackResult> {
    try {
      switch (event.type) {
        case 'dispatched': {
          if (event.trackingNumber === undefined || event.trackingNumber.length === 0) {
            return {
              outcome: 'unsupported',
              detail: 'Amazon needs a tracking number to confirm a shipment; sent once the carrier issues it',
            };
          }
          const order = await this.readOrder(event.externalOrderId);
          if (order.fulfillment?.fulfilledBy === 'AMAZON') {
            return { outcome: 'unsupported', detail: 'Amazon ships this order itself (FBA)' };
          }
          await this.confirmShipment(order, event.trackingNumber, event.carrier?.platformType);
          return { outcome: 'applied' };
        }
        case 'cancelled':
        case 'delivered':
        case 'in-progress':
        case 'paid':
          return {
            outcome: 'unsupported',
            detail: `the Amazon Orders API has no seller call for '${event.type}'`,
          };
        default: {
          const unhandled: never = event;
          return { outcome: 'unsupported', detail: `unsupported order lifecycle event: ${JSON.stringify(unhandled)}` };
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `OrderStatusWriteback '${event.type}' rejected for Amazon order ${event.externalOrderId}: ${detail} (connection: ${this.connectionId})`,
      );
      return { outcome: 'rejected', detail, ...(isTransient(error) ? { transient: true } : {}) };
    }
  }

  listOrderStatuses(): Promise<MappingOption[]> {
    return Promise.resolve(AmazonFulfillmentStatusValues.map((value) => ({ value, label: value })));
  }

  listDeliveryMethods(): Promise<MappingOption[]> {
    return Promise.resolve(AmazonServiceLevelValues.map((value) => ({ value, label: value })));
  }

  listPaymentMethods(): Promise<MappingOption[]> {
    return Promise.resolve(DOCUMENTED_PAYMENT_METHODS.map((value) => ({ value, label: value })));
  }

  protected async readOrder(orderId: string): Promise<AmazonOrder> {
    const response = await this.client.get<AmazonGetOrderResponse>(
      `${SEARCH_ORDERS_PATH}/${encodeURIComponent(orderId)}`,
      { includedData: GET_ORDER_INCLUDED_DATA },
    );
    return response.data.order;
  }

  private async confirmShipment(
    order: AmazonOrder,
    trackingNumber: string,
    carrierPlatformType: string | undefined,
  ): Promise<void> {
    const marketplaceId = order.salesChannel.marketplaceId ?? this.config.marketplaceIds[0];
    const carrier = resolveAmazonCarrier(carrierPlatformType);
    const body: AmazonConfirmShipmentRequest = {
      marketplaceId,
      packageDetail: {
        // Amazon takes only a positive number here; derived from the tracking number.
        packageReferenceId: amazonPackageReferenceId(trackingNumber),
        carrierCode: carrier.carrierCode,
        ...(carrier.carrierName ? { carrierName: carrier.carrierName } : {}),
        trackingNumber,
        shipDate: this.now().toISOString(),
        orderItems: order.orderItems.map((item) => ({
          orderItemId: item.orderItemId,
          quantity: item.quantityOrdered,
        })),
      },
    };
    await this.client.post(`/orders/v0/orders/${encodeURIComponent(order.orderId)}/shipmentConfirmation`, body);
  }
}

function toFeedItem(order: AmazonOrder): OrderFeedItem {
  const status = order.fulfillment?.fulfillmentStatus;
  const eventType =
    status === 'CANCELLED' ? 'cancelled' : order.createdTime === order.lastUpdatedTime ? 'created' : 'updated';
  return {
    externalOrderId: order.orderId,
    eventType,
    occurredAt: order.lastUpdatedTime,
    eventKey: `${order.orderId}:${order.lastUpdatedTime}`,
  };
}

function isTransient(error: unknown): boolean {
  return (
    error instanceof AmazonNetworkError ||
    error instanceof RateLimitTimeoutError ||
    error instanceof RateLimitAbortedError ||
    (error instanceof AmazonApiError && (error.statusCode === 429 || error.statusCode >= 500))
  );
}
