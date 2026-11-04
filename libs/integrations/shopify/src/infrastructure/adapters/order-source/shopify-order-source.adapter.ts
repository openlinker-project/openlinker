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
 * Returns are invisible to this feed: a return does not bump the order's
 * `updatedAt` (L-R1). Not implemented here (ReturnSourceReader is out of scope).
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/order-source
 * @implements {OrderSourcePort}
 */
import type {
  IncomingOrder,
  OrderFeedEventType,
  OrderFeedInput,
  OrderFeedItem,
  OrderFeedOutput,
  OrderSourcePort,
} from '@openlinker/core/orders';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';

import { ShopifyOrderNotFoundException } from '../../../domain/exceptions/shopify-order-not-found.exception';
import { shopifyStoreHandle } from '../../../domain/policies/shopify-config.policy';
import { fromShopifyGid, toShopifyGid } from '../../../domain/policies/shopify-gid.policy';
import type {
  ShopifyConnection,
  ShopifyOrder,
  ShopifyOrderFeedRow,
} from '../../../domain/types/shopify-api.types';
import type { ShopifyOrderFeedCursor } from '../../../domain/types/shopify-order-feed.types';
import type { ShopifyGraphqlClient } from '../../http/shopify-graphql-client';
import {
  formatShopifyFeedCursor,
  isAfterShopifyCursor,
  parseShopifyFeedCursor,
} from '../../mappers/shopify-order-feed-cursor.mapper';
import { mapShopifyOrderToIncoming } from '../../mappers/shopify-incoming-order.mapper';
import { ORDER_BY_ID_QUERY, ORDER_FEED_QUERY } from '../../readers/shopify-order.queries';

/** Longer than the measured 5-10 s index lag (L-M2), with margin. */
const SETTLE_WINDOW_MS = 30_000;
const FEED_PAGE_SIZE = 100;
/** Bounds one poll; the next tick resumes from the cursor. */
const MAX_FEED_PAGES = 20;
const EPOCH = '1970-01-01T00:00:00Z';

export class ShopifyOrderSourceAdapter implements OrderSourcePort {
  private readonly logger = new Logger(ShopifyOrderSourceAdapter.name);

  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly storeDomain: string,
    private readonly connection: Connection,
  ) {}

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
    return mapShopifyOrderToIncoming(data.order, {
      adminOrderUrl:
        `https://admin.shopify.com/store/${shopifyStoreHandle(this.storeDomain)}` +
        `/orders/${input.externalOrderId}`,
    });
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
