/**
 * Shopify Order Source Adapter
 *
 * Implements `OrderSourcePort`: an incremental feed over
 * `orders(query: "updated_at:>='...'", sortKey: UPDATED_AT)` and a full read
 * of one order (`order(id:)`).
 *
 * The feed is a strict `(updatedAt, id)` keyset (see the cursor mapper), so an
 * order sharing a timestamp with the watermark is neither skipped nor repeated.
 * One Shopify fact shapes it: `updated_at` filtering goes through the search
 * index, which lags a write by seconds (L-M1, L-M2). An order updated just
 * before the newest one the feed saw could therefore still be missing from the
 * index - and a keyset that moved past it would never look back. So the feed
 * only hands out orders whose `updatedAt` is older than a SETTLE window; a
 * newer order waits for the next poll, by which time the index has it.
 *
 * Event type: `cancelled` when the order carries `cancelledAt`, `created` when
 * it has not changed since it was created, `updated` otherwise. Core re-reads
 * the order through `getOrder` either way, so the type is a hint.
 *
 * Mapping options (`SourceOptionsReader`, case C13): delivery methods,
 * payment gateways and the neutral statuses an ingested order carries, so a
 * routing rule or carrier mapping can be keyed on a Shopify delivery method.
 * See `ShopifyMappingOptionsReader` for why a method is listed by NAME.
 *
 * Returns are invisible to this feed: a return does not bump the order's
 * `updatedAt` (L-R1). They have a feed of their own - see `ReturnSourceReader`
 * below - and `declineReturn` refuses one still `REQUESTED` (`ReturnDecliner`).
 *
 * Status writeback (`OrderStatusWriteback`): delegated to
 * `ShopifyOrderStatusWriteback`, so a dispatch made in OpenLinker fulfils the
 * order on the shop it came from (L-S3c).
 *
 * Refunds: `ShopifyRefundingOrderSourceAdapter` below adds `RefundExecutor` on
 * a connection with `refundsThroughShopify: true` (C20); without it a refund
 * confirmed in OpenLinker is only recorded.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/order-source
 * @implements {OrderSourcePort}
 * @implements {ReturnSourceReader}
 * @implements {SourceOptionsReader}
 */
import type {
  ExecuteRefundCommand,
  IncomingOrder,
  MappingOption,
  OrderFeedEventType,
  OrderFeedInput,
  OrderFeedItem,
  OrderFeedOutput,
  OrderSourcePort,
  RefundExecutionResult,
  RefundExecutor,
  ReturnDecliner,
  ReturnSourceReader,
  SourceOptionsReader,
} from '@openlinker/core/orders';
import type {
  IncomingReturn,
  ReturnDeclineCommand,
  ReturnDeclineResult,
  ReturnFeedInput,
  ReturnFeedItem,
  ReturnFeedOutput,
} from '@openlinker/core/returns';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type {
  OrderLifecycleEvent,
  OrderStatusWriteback,
  OrderWritebackResult,
} from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

import { ShopifyOrderNotFoundException } from '../../../domain/exceptions/shopify-order-not-found.exception';
import { ShopifyReturnNotFoundException } from '../../../domain/exceptions/shopify-return-not-found.exception';
import { ShopifyUserErrorsException } from '../../../domain/exceptions/shopify-user-errors.exception';
import { shopifyStoreHandle } from '../../../domain/policies/shopify-config.policy';
import { fromShopifyGid, toShopifyGid } from '../../../domain/policies/shopify-gid.policy';
import type {
  ShopifyConnection,
  ShopifyOrder,
  ShopifyOrderFeedRow,
} from '../../../domain/types/shopify-api.types';
import type { ShopifyOrderFeedCursor } from '../../../domain/types/shopify-order-feed.types';
import {
  SHOPIFY_RETURN_TERMINAL_STATUSES,
  type ShopifyReturnFeedOrderRow,
  type ShopifyReturnNode,
} from '../../../domain/types/shopify-return.types';
import type { ShopifyGraphqlClient } from '../../http/shopify-graphql-client';
import {
  formatShopifyFeedCursor,
  isAfterShopifyCursor,
  parseShopifyFeedCursor,
} from '../../mappers/shopify-order-feed-cursor.mapper';
import { mapShopifyOrderToIncoming } from '../../mappers/shopify-incoming-order.mapper';
import { mapShopifyReturnToIncoming } from '../../mappers/shopify-incoming-return.mapper';
import {
  formatShopifyReturnFeedCursor,
  parseShopifyReturnFeedCursor,
} from '../../mappers/shopify-return-feed-cursor.mapper';
import type { ShopifyRefundExecutor } from './shopify-refund-executor';
import { ShopifyMappingOptionsReader } from '../../readers/shopify-mapping-options.reader';
import { ORDER_BY_ID_QUERY, ORDER_FEED_QUERY } from '../../readers/shopify-order.queries';
import {
  RETURN_BY_ID_QUERY,
  RETURN_DECLINE_MUTATION,
  RETURN_FEED_QUERY,
  RETURN_STATUS_QUERY,
  SHOPIFY_RETURN_FEED_FILTER,
} from '../../readers/shopify-return.queries';

/** Longer than the measured 5-10 s index lag (L-M2), with margin. */
const SETTLE_WINDOW_MS = 30_000;
const FEED_PAGE_SIZE = 100;
/** Bounds one poll; the next tick resumes from the cursor. */
const MAX_FEED_PAGES = 20;
const EPOCH = '1970-01-01T00:00:00Z';
/** Orders read per return-feed page; each carries its returns' ids, never their lines. */
const RETURN_FEED_ORDERS_PER_PAGE = 50;

/**
 * Also an `OrderStatusWriteback`: the lifecycle relay asks the SOURCE participant
 * through its `OrderSource` adapter, so a dispatch on an order that came from
 * Shopify is written back by the same code the destination role uses.
 */
export class ShopifyOrderSourceAdapter
  implements OrderSourcePort, ReturnSourceReader, ReturnDecliner, OrderStatusWriteback, SourceOptionsReader
{
  /** Shopify's own `ReturnDeclineReason` values; core treats them as opaque. */
  readonly declineReasonCodes: readonly string[] = ['RETURN_PERIOD_ENDED', 'FINAL_SALE', 'OTHER'];

  private readonly logger = new Logger(ShopifyOrderSourceAdapter.name);
  private readonly options: ShopifyMappingOptionsReader;

  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly storeDomain: string,
    private readonly connection: Connection,
    private readonly writeback: OrderStatusWriteback,
  ) {
    this.options = new ShopifyMappingOptionsReader(client, connection.id);
  }

  listOrderStatuses(): Promise<MappingOption[]> {
    return this.options.listOrderStatuses();
  }

  listDeliveryMethods(): Promise<MappingOption[]> {
    return this.options.listDeliveryMethods();
  }

  listPaymentMethods(): Promise<MappingOption[]> {
    return this.options.listPaymentMethods();
  }

  write(event: OrderLifecycleEvent): Promise<OrderWritebackResult> {
    return this.writeback.write(event);
  }

  async listOrderFeed(input: OrderFeedInput): Promise<OrderFeedOutput> {
    const cursor = parseShopifyFeedCursor(input.fromCursor, this.connection.id);
    const settledBefore = Date.now() - SETTLE_WINDOW_MS;
    const limit = Math.max(1, input.limit);
    const wanted = input.eventTypes === undefined ? null : new Set(input.eventTypes);

    const items: OrderFeedItem[] = [];
    let last: ShopifyOrderFeedCursor = cursor;
    let after: string | null = null;
    let pages = 0;
    let reachedUnsettled = false;

    while (items.length < limit && !reachedUnsettled && pages < MAX_FEED_PAGES) {
      pages += 1;
      const data: { orders: ShopifyConnection<ShopifyOrderFeedRow> } = await this.client.query(
        ORDER_FEED_QUERY,
        {
          first: FEED_PAGE_SIZE,
          after,
          query: `updated_at:>='${cursor.updatedAt ?? EPOCH}'`,
        },
      );
      for (const row of data.orders.nodes) {
        const orderId = fromShopifyGid(row.id);
        if (Date.parse(row.updatedAt) > settledBefore) {
          reachedUnsettled = true;
          break;
        }
        if (!isAfterShopifyCursor(cursor, row.updatedAt, orderId)) {
          continue;
        }
        last = { updatedAt: new Date(row.updatedAt).toISOString(), orderId };
        const eventType = this.eventTypeOf(row);
        if (wanted === null || wanted.has(eventType)) {
          items.push({
            externalOrderId: orderId,
            eventType,
            occurredAt: row.updatedAt,
            eventKey: `${orderId}:${row.updatedAt}`,
          });
        }
        if (items.length >= limit) {
          break;
        }
      }
      if (data.orders.pageInfo?.hasNextPage !== true) {
        break;
      }
      after = data.orders.pageInfo.endCursor;
    }

    return {
      items,
      // Advanced over filtered-out event types too, so they are not re-read forever.
      nextCursor: formatShopifyFeedCursor(last) ?? input.fromCursor ?? null,
    };
  }

  async getOrder(input: { externalOrderId: string }): Promise<IncomingOrder> {
    const data = await this.client.query<{ order: ShopifyOrder | null }>(ORDER_BY_ID_QUERY, {
      id: toShopifyGid('Order', input.externalOrderId),
    });
    if (data.order === null) {
      throw new ShopifyOrderNotFoundException(input.externalOrderId, this.connection.id);
    }
    if (data.order.lineItems.pageInfo?.hasNextPage === true) {
      this.logger.warn(
        `Shopify order ${input.externalOrderId} has more than ${data.order.lineItems.nodes.length} lines; ` +
          `the rest are not ingested (connection: ${this.connection.id})`,
      );
    }
    if (data.order.presentmentCurrencyCode !== data.order.currencyCode) {
      // Every figure is read in the shop's currency (the one the rest of this
      // connection uses); the buyer paid in another, so the amounts differ.
      this.logger.warn(
        `Shopify order ${input.externalOrderId} was paid in ${data.order.presentmentCurrencyCode}; ` +
          `it is ingested in the shop currency ${data.order.currencyCode} (connection: ${this.connection.id})`,
      );
    }
    return mapShopifyOrderToIncoming(data.order, {
      adminOrderUrl:
        `https://admin.shopify.com/store/${shopifyStoreHandle(this.storeDomain)}` +
        `/orders/${input.externalOrderId}`,
    });
  }

  // ─── ReturnSourceReader ────────────────────────────────────────────────────

  /**
   * Shopify's own words for a finished return, published so core's re-read
   * sweep excludes them in its query. The same constant backs the per-read
   * `isTerminalAtSource` hint.
   */
  readonly terminalRawStatuses: readonly string[] = SHOPIFY_RETURN_TERMINAL_STATUSES;

  /**
   * One page of the return feed: the orders that carry a return, walked by
   * order id from the newest down, in laps (see the cursor mapper), one item
   * per return on them.
   *
   * The feed only reports that a return EXISTS; `getReturn` is the re-read
   * that observes it moving, because nothing on the order moves when a return
   * changes. A whole order's returns go out together, so a page may exceed
   * `limit` by the returns of its last order - splitting one would need a
   * second cursor dimension for no gain.
   *
   * Blind spots, each closed by a later lap or by nothing:
   *   - the order search index lags a write by seconds, so a brand-new return
   *     is found on the next lap rather than this one;
   *   - a return opened and declined/canceled between two laps, on an order
   *     that drops back to `no_return`, is never seen - acceptable, it carried
   *     no goods;
   *   - more than `SHOPIFY_RETURNS_PER_ORDER` returns on one order: the rest
   *     are missed (warned).
   */
  async listReturnFeed(input: ReturnFeedInput): Promise<ReturnFeedOutput> {
    const cursor = parseShopifyReturnFeedCursor(input.fromCursor, this.connection.id, new Date());
    const limit = Math.max(1, input.limit);
    const query =
      cursor.belowOrderId === null
        ? SHOPIFY_RETURN_FEED_FILTER
        : `${SHOPIFY_RETURN_FEED_FILTER} AND id:<${cursor.belowOrderId}`;

    const data: { orders: ShopifyConnection<ShopifyReturnFeedOrderRow> } = await this.client.query(
      RETURN_FEED_QUERY,
      { first: Math.min(limit, RETURN_FEED_ORDERS_PER_PAGE), query },
    );

    if (data.orders.nodes.length === 0) {
      // End of the lap. A fresh lap start changes the cursor, so core commits
      // it and the next poll walks every returning order again from the newest.
      return {
        items: [],
        nextCursor: formatShopifyReturnFeedCursor({ lapStartedAt: new Date().toISOString(), belowOrderId: null }),
      };
    }

    const items: ReturnFeedItem[] = [];
    let belowOrderId = cursor.belowOrderId;
    for (const order of data.orders.nodes) {
      const orderId = fromShopifyGid(order.id);
      if (order.returns.pageInfo?.hasNextPage === true) {
        this.logger.warn(
          `Shopify order ${orderId} has more returns than ${order.returns.nodes.length}; ` +
            `the rest are not discovered (connection: ${this.connection.id})`,
        );
      }
      for (const ret of order.returns.nodes) {
        const returnId = fromShopifyGid(ret.id);
        items.push({
          externalReturnId: returnId,
          externalOrderId: orderId,
          occurredAt: ret.createdAt ?? cursor.lapStartedAt,
          // The return id itself: core dedupes it permanently, so a later lap
          // re-reporting the same return enqueues nothing.
          eventKey: returnId,
          raw: ret,
        });
      }
      belowOrderId = orderId;
      if (items.length >= limit) {
        break;
      }
    }

    return {
      items,
      nextCursor: formatShopifyReturnFeedCursor({ lapStartedAt: cursor.lapStartedAt, belowOrderId }),
    };
  }

  /**
   * `returnDeclineRequest` only declines a return still in `REQUESTED`. Shopify
   * reports no decline instant, so `declinedAt` is `null` (never OL's clock).
   * A return that is already `DECLINED` is a success: the intent is satisfied.
   */
  async declineReturn(command: ReturnDeclineCommand): Promise<ReturnDeclineResult> {
    const id = toShopifyGid('Return', command.externalReturnId);
    const known = this.declineReasonCodes.includes(command.reasonCode);
    if (!known) {
      this.logger.warn(
        `Decline reason "${command.reasonCode}" is not one Shopify knows; return ${command.externalReturnId} ` +
          `is declined as OTHER (connection: ${this.connection.id})`,
      );
    }
    const reason = known ? command.reasonCode : 'OTHER';
    const data = await this.client.query<{
      returnDeclineRequest: {
        return: { status: string } | null;
        userErrors: ReadonlyArray<{ code: string | null; message: string }>;
      } | null;
    }>(
      RETURN_DECLINE_MUTATION,
      {
        input: {
          id,
          declineReason: reason,
          notifyCustomer: false,
          ...(command.comment ? { declineNote: command.comment.slice(0, 500) } : {}),
        },
      },
    );
    const payload = data.returnDeclineRequest;
    const errors = payload?.userErrors ?? [];
    if (errors.length > 0) {
      const current = await this.client.query<{ node: { status?: string } | null }>(RETURN_STATUS_QUERY, { id });
      if (current.node?.status === 'DECLINED') {
        return { declinedAt: null, rawStatus: 'DECLINED', raw: errors };
      }
      throw new ShopifyUserErrorsException('returnDeclineRequest', errors);
    }
    return { declinedAt: null, rawStatus: payload?.return?.status ?? null, raw: payload };
  }

  /**
   * One return by its numeric id, with its lines. Both the hydration of a newly
   * discovered return and the ONLY way a known one is seen to move.
   */
  async getReturn(input: { externalReturnId: string }): Promise<IncomingReturn> {
    const data = await this.client.query<{ node: ShopifyReturnNode | { __typename: string } | null }>(
      RETURN_BY_ID_QUERY,
      { id: toShopifyGid('Return', input.externalReturnId) },
    );
    const node = data.node;
    if (node === null || node.__typename !== 'Return') {
      throw new ShopifyReturnNotFoundException(input.externalReturnId, this.connection.id);
    }
    const ret = node as ShopifyReturnNode;
    if (ret.returnLineItems.pageInfo?.hasNextPage === true) {
      this.logger.warn(
        `Shopify return ${input.externalReturnId} has more than ${ret.returnLineItems.nodes.length} lines; ` +
          `the rest are not ingested (connection: ${this.connection.id})`,
      );
    }
    return mapShopifyReturnToIncoming(ret);
  }

  private eventTypeOf(row: ShopifyOrderFeedRow): OrderFeedEventType {
    if (row.cancelledAt !== null) {
      return 'cancelled';
    }
    // `orderCreate` stamps `updatedAt` a second or so after `createdAt` (seen
    // on every seeded order), so equality would never hold.
    return Date.parse(row.updatedAt) - Date.parse(row.createdAt) <= 5_000 ? 'created' : 'updated';
  }
}

/**
 * The order source on a connection with `refundsThroughShopify: true`: also a
 * `RefundExecutor`, so core sends a confirmed refund to Shopify instead of
 * recording it as made out of band. A separate class rather than a flag, because
 * core detects the capability by the method's presence (`isRefundExecutor`).
 */
export class ShopifyRefundingOrderSourceAdapter extends ShopifyOrderSourceAdapter implements RefundExecutor {
  constructor(
    client: ShopifyGraphqlClient,
    storeDomain: string,
    connection: Connection,
    writeback: OrderStatusWriteback,
    private readonly refunds: ShopifyRefundExecutor,
  ) {
    super(client, storeDomain, connection, writeback);
  }

  executeRefund(command: ExecuteRefundCommand): Promise<RefundExecutionResult> {
    return this.refunds.executeRefund(command);
  }
}
