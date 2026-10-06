/**
 * Shoper Order Source Adapter
 *
 * Implements `OrderSourcePort` for orders placed in a Shoper shop. The feed is an
 * `order_id` KEYSET: `order=order_id ASC` plus `filters[order_id][>]=<cursor>`
 * (both live-verified), so each poll reads only what is new, no date field, time
 * zone or same-second edge is involved, and the cursor is the highest id seen.
 *
 * Known limit: an id-ordered feed observes NEW orders only. Shoper has no bulk
 * modified-since for orders (`object-mtime` is per object, SPIKE-3638 M7), so a
 * later edit of an already-read order is not re-observed by a poll. That is the
 * trade-off PrestaShop accepts when `date_upd` cannot be filtered (#2877), and
 * the reason the webhook backstop (#3644) is the update channel.
 *
 * An order OpenLinker created in the shop (`notes_priv` carries
 * `ORDER_MARKER_PREFIX`) is dropped from the feed, otherwise it would re-enter
 * as a new source order. The cursor still advances over it.
 *
 * @module libs/integrations/shoper/src/infrastructure/adapters/order-source
 * @implements {OrderSourcePort}
 */
import type {
  IncomingOrder,
  OrderFeedInput,
  OrderFeedItem,
  OrderFeedOutput,
  OrderSourcePort,
} from '@openlinker/core/orders';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';

import { ShoperNetworkError } from '../../../domain/exceptions/shoper-network.error';
import type { ShoperOrderLineRow, ShoperOrderRow } from '../../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../../http/shoper-http-client';
import { SHOPER_MAX_PAGE_SIZE, fetchShoperPage } from '../../http/shoper-pagination';
import {
  mapShoperOrderStatus,
  mapShoperOrderToIncoming,
  shopLocalToIso,
} from '../../mappers/shoper-incoming-order.mapper';
import { ORDER_MARKER_PREFIX } from '../../mappers/shoper-order-input.mapper';
import type { ShoperOrderStatusInfo } from '../../../domain/types/shoper-order-status.types';
import type { ShoperOrderReferenceProvider } from '../../shop-context/shoper-order-reference.provider';
import type { ShoperShopContextProvider } from '../../shop-context/shoper-shop-context.provider';

/** Shoper order ids are positive integers; anything else is refused before a URL is built. */
const ORDER_ID = /^\d+$/;

export class ShoperOrderSourceAdapter implements OrderSourcePort {
  private readonly logger = new Logger(ShoperOrderSourceAdapter.name);

  constructor(
    private readonly client: ShoperHttpClient,
    private readonly reference: ShoperOrderReferenceProvider,
    private readonly shopContext: ShoperShopContextProvider,
    private readonly connection: Connection,
  ) {}

  async listOrderFeed(input: OrderFeedInput): Promise<OrderFeedOutput> {
    const cursor = input.fromCursor;
    if (cursor !== null && cursor !== undefined && !ORDER_ID.test(cursor)) {
      throw new RangeError(
        `Shoper order feed cursor must be a numeric order id, got "${cursor}" (connection: ${this.connection.id})`,
      );
    }
    const limit = Math.min(Math.max(Math.trunc(input.limit), 1), SHOPER_MAX_PAGE_SIZE);

    const page = await fetchShoperPage<ShoperOrderRow>(this.client, '/orders', {
      page: 1,
      limit,
      query: {
        // Explicit direction: a bare `order=<field>` sorts DESCENDING on Shoper.
        order: 'order_id ASC',
        ...(cursor === null || cursor === undefined ? {} : { 'filters[order_id][>]': cursor }),
      },
    });

    if (page.items.length === 0) {
      return { items: [], nextCursor: cursor ?? null };
    }

    // Computed over EVERY row before the echo filter: a page made only of our own
    // orders must still advance the cursor, or the feed freezes on it.
    const nextCursor = page.items.reduce<string>(
      (max, row) => (Number(row.order_id) > Number(max) ? String(row.order_id) : max),
      cursor ?? '0',
    );

    const { timezone } = await this.shopContext.get();

    const items: OrderFeedItem[] = [];
    for (const row of page.items) {
      if (isOwnOrder(row)) {
        continue;
      }
      const id = String(row.order_id);
      // A terminal order is reported as `cancelled` even on first sight: core
      // routes that event through the cancellation relay and never through the
      // create/update path, which would mirror an already-dead order to its
      // destinations (the PrestaShop and WooCommerce sources do the same).
      const status = await this.statusOf(row);
      const neutral = mapShoperOrderStatus(status);
      const eventType = neutral === 'cancelled' || neutral === 'refunded' ? 'cancelled' : 'created';
      if (input.eventTypes !== undefined && !input.eventTypes.includes(eventType)) {
        continue;
      }
      items.push({
        externalOrderId: id,
        eventType,
        occurredAt: shopLocalToIso(row.date, timezone ?? null) ?? new Date(0).toISOString(),
        eventKey: `${id}:${eventType}`,
      });
    }

    return { items, nextCursor };
  }

  async getOrder(input: { externalOrderId: string }): Promise<IncomingOrder> {
    const { externalOrderId } = input;
    if (!ORDER_ID.test(externalOrderId)) {
      throw new RangeError(
        `Shoper order id must be numeric, got "${externalOrderId}" (connection: ${this.connection.id})`,
      );
    }

    this.logger.debug('Fetching Shoper order', {
      connectionId: this.connection.id,
      externalOrderId,
    });

    // A 404 / 401 / 5xx surfaces as ShoperApiError and is classified by the
    // retry and auth-failure classifiers; it is not translated here.
    const { data: row } = await this.client.get<ShoperOrderRow>(`/orders/${externalOrderId}`);
    if (String(row.order_id) !== externalOrderId) {
      throw new ShoperNetworkError(
        `Shoper returned order ${String(row.order_id)} for ${externalOrderId}`,
      );
    }

    const lines = await this.readLines(externalOrderId);
    const currencyId = row.currency_id === null || row.currency_id === undefined ? null : String(row.currency_id);
    const shippingId = row.shipping_id === null || row.shipping_id === undefined ? null : String(row.shipping_id);

    const [status, currencyCode, shippingName, shop] = await Promise.all([
      this.statusOf(row),
      currencyId === null ? null : this.reference.getCurrencyCode(currencyId),
      shippingId === null ? null : this.reference.getShippingName(shippingId),
      this.shopContext.get(),
    ]);

    if (status === null && row.status_id !== null && row.status_id !== undefined) {
      this.logger.warn(
        `Shoper order ${externalOrderId} has status ${String(row.status_id)} which the shop does not list; ` +
          `reading it as pending (connection: ${this.connection.id})`,
      );
    }

    return mapShoperOrderToIncoming(row, lines, {
      status,
      currencyCode,
      shippingName,
      timezone: shop.timezone ?? null,
    });
  }

  private async statusOf(row: ShoperOrderRow): Promise<ShoperOrderStatusInfo | null> {
    return row.status_id === null || row.status_id === undefined
      ? null
      : this.reference.getStatus(String(row.status_id));
  }

  private async readLines(orderId: string): Promise<ShoperOrderLineRow[]> {
    const lines: ShoperOrderLineRow[] = [];
    for (let page = 1; ; page += 1) {
      const result = await fetchShoperPage<ShoperOrderLineRow>(this.client, '/order-products', {
        page,
        limit: SHOPER_MAX_PAGE_SIZE,
        query: { 'filters[order_id]': orderId, order: 'id ASC' },
      });
      for (const line of result.items) {
        // A row of ANOTHER order proves the filter was not honoured: the lines
        // of the whole table would be ingested as this order's.
        if (String(line.order_id) !== orderId) {
          throw new ShoperNetworkError(
            `Shoper returned a line of order ${String(line.order_id)} while reading order ${orderId}; ` +
              'the order-products filter was not honoured',
          );
        }
        lines.push(line);
      }
      if (page >= result.pages) {
        return lines;
      }
    }
  }
}

function isOwnOrder(row: ShoperOrderRow): boolean {
  return typeof row.notes_priv === 'string' && row.notes_priv.startsWith(ORDER_MARKER_PREFIX);
}
