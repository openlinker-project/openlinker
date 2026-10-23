/**
 * Shoper Order Source Adapter
 *
 * Implements `OrderSourcePort` for orders placed in a Shoper shop, plus
 * `OrderStatusWriteback` (the lifecycle relay reaches a source-only shop through
 * this capability) and `SourceOptionsReader` (the mapping page's source lists).
 *
 * **The feed reads two passes per poll**, both carried in one opaque cursor (see
 * `ShoperOrderFeedCursor`):
 *
 *   1. NEW orders: an `order_id` KEYSET, `order=order_id ASC` plus
 *      `filters[order_id][>]=<cursor>` (both live-verified). No date field, time
 *      zone or same-second edge is involved.
 *   2. STATUS CHANGES of orders already read: `status_date >= <watermark - lookback>`,
 *      `order=status_date ASC`. Shoper has no bulk modified-since for orders
 *      (`object-mtime` is per object, SPIKE-3638 M7), but `status_date` moves on
 *      every status change, API-made ones included (live-verified), so it is the
 *      one update marker a poll can filter on. An edit that does NOT change the
 *      status (notes, address) still reaches OpenLinker only through its webhook.
 *
 * Why one cursor and not a second scheduler task: `listOrderFeed` learns nothing
 * but the cursor, so a second task with its own cursor key would reach this same
 * method unable to tell which pass it was asked for, and both tasks would contend
 * for the one per-connection ingestion lock.
 *
 * The status pass re-reads a LOOKBACK window behind its watermark on every poll,
 * because `status_date` is second-precise and a change committed late may carry a
 * second the previous poll already passed. Re-reading is free: a row whose status
 * did not change again yields the same event key, which the job queue dedupes.
 * A status change in the new-orders pass's own range is left to that pass, which
 * reads the order's current state anyway.
 *
 * An order OpenLinker created in the shop (`notes_priv` carries
 * `ORDER_MARKER_PREFIX`) is dropped from both passes, otherwise it would re-enter
 * as a source order. The cursor still advances over it.
 *
 * @module libs/integrations/shoper/src/infrastructure/adapters/order-source
 * @implements {OrderSourcePort}
 * @implements {OrderStatusWriteback}
 * @implements {SourceOptionsReader}
 */
import type {
  IncomingOrder,
  MappingOption,
  OrderFeedEventType,
  OrderFeedInput,
  OrderFeedItem,
  OrderFeedOutput,
  OrderLifecycleEvent,
  OrderSourcePort,
  OrderStatusWriteback,
  OrderWritebackResult,
  SourceOptionsReader,
} from '@openlinker/core/orders';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';

import { ShoperNetworkError } from '../../../domain/exceptions/shoper-network.error';
import type { ShoperOrderLineRow, ShoperOrderRow } from '../../../domain/types/shoper-api.types';
import type {
  ShoperOrderFeedCursor,
  ShoperStatusPassResult,
  ShoperStatusPassState,
} from '../../../domain/types/shoper-order-feed.types';
import type { ShoperOrderStatusInfo } from '../../../domain/types/shoper-order-status.types';
import type { ShoperHttpClient } from '../../http/shoper-http-client';
import { SHOPER_MAX_PAGE_SIZE, fetchShoperPage } from '../../http/shoper-pagination';
import {
  mapShoperOrderStatus,
  mapShoperOrderToIncoming,
  shopLocalToIso,
} from '../../mappers/shoper-incoming-order.mapper';
import {
  formatShoperFeedCursor,
  isWallClock,
  laterWallClock,
  parseShoperFeedCursor,
  shiftWallClockBack,
} from '../../mappers/shoper-order-feed-cursor.mapper';
import { ORDER_MARKER_PREFIX } from '../../mappers/shoper-order-input.mapper';
import { listShoperMappingOptions } from '../../readers/shoper-mapping-options.reader';
import type { ShoperOrderReferenceProvider } from '../../shop-context/shoper-order-reference.provider';
import type { ShoperShopContextProvider } from '../../shop-context/shoper-shop-context.provider';
import { ShoperOrderStatusWriter } from '../order-status/shoper-order-status-writer';

/** Shoper order ids are positive integers; anything else is refused before a URL is built. */
const ORDER_ID = /^\d+$/;

/**
 * How far behind its watermark the status pass re-reads. Covers a status change
 * committed with a second the previous poll had already passed. It does NOT cover
 * the autumn DST fold: the shop's naive clock repeats an hour then, and a change
 * stamped inside the repeated hour is older than the watermark by more than this,
 * so it is seen only through its webhook. Once a year, accepted.
 */
export const SHOPER_STATUS_LOOKBACK_SECONDS = 300;

/** Upper bound on status-pass pages per poll, so one poll's request count stays small. */
const MAX_STATUS_PAGES_PER_POLL = 4;

const NEUTRAL_STATUS_LABEL: Readonly<Record<string, string>> = {
  pending: 'Pending',
  processing: 'Processing',
  shipped: 'Shipped',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export class ShoperOrderSourceAdapter implements OrderSourcePort, OrderStatusWriteback, SourceOptionsReader {
  private readonly logger = new Logger(ShoperOrderSourceAdapter.name);
  private readonly statusWriter: ShoperOrderStatusWriter;

  constructor(
    private readonly client: ShoperHttpClient,
    private readonly reference: ShoperOrderReferenceProvider,
    private readonly shopContext: ShoperShopContextProvider,
    private readonly connection: Connection,
  ) {
    this.statusWriter = new ShoperOrderStatusWriter(client, connection, reference);
  }

  async listOrderFeed(input: OrderFeedInput): Promise<OrderFeedOutput> {
    const cursor = parseShoperFeedCursor(input.fromCursor, this.connection.id);
    const limit = Math.min(Math.max(Math.trunc(input.limit), 1), SHOPER_MAX_PAGE_SIZE);
    const { timezone } = await this.shopContext.get();
    const zone = timezone ?? null;

    const fresh = await this.readNewOrders(cursor.lastOrderId, limit, zone, input.eventTypes);
    const emitted = new Set(fresh.rows.map((row) => String(row.order_id)));
    const status = await this.readStatusChanges(cursor, input, fresh.lastOrderId, emitted, zone);

    return {
      items: dedupeByEventKey([...fresh.items, ...status.items]),
      nextCursor: formatShoperFeedCursor({ lastOrderId: fresh.lastOrderId, ...status.cursor }),
    };
  }

  // ─── Pass 1: new orders (order_id keyset) ──────────────────────────────────

  private async readNewOrders(
    after: string | null,
    limit: number,
    timezone: string | null,
    eventTypes: OrderFeedEventType[] | undefined,
  ): Promise<{ items: OrderFeedItem[]; rows: readonly ShoperOrderRow[]; lastOrderId: string | null }> {
    const page = await fetchShoperPage<ShoperOrderRow>(this.client, '/orders', {
      page: 1,
      limit,
      query: {
        // Explicit direction: a bare `order=<field>` sorts DESCENDING on Shoper.
        order: 'order_id ASC',
        ...(after === null ? {} : { 'filters[order_id][>]': after }),
      },
    });

    // Computed over EVERY row before the echo filter: a page made only of our own
    // orders must still advance the cursor, or the feed freezes on it.
    const lastOrderId = page.items.reduce<string | null>(
      (max, row) => (max === null || Number(row.order_id) > Number(max) ? String(row.order_id) : max),
      after,
    );

    const items: OrderFeedItem[] = [];
    const rows: ShoperOrderRow[] = [];
    for (const row of page.items) {
      if (isOwnOrder(row)) {
        continue;
      }
      const id = String(row.order_id);
      // A terminal order is reported as `cancelled` even on first sight: core
      // routes that event through the cancellation relay and never through the
      // create/update path, which would mirror an already-dead order to its
      // destinations (the PrestaShop and WooCommerce sources do the same).
      const eventType = isTerminal(await this.statusOf(row)) ? 'cancelled' : 'created';
      rows.push(row);
      if (eventTypes !== undefined && !eventTypes.includes(eventType)) {
        continue;
      }
      items.push({
        externalOrderId: id,
        eventType,
        occurredAt: shopLocalToIso(row.date, timezone) ?? new Date(0).toISOString(),
        eventKey: `${id}:${eventType}`,
      });
    }
    return { items, rows, lastOrderId };
  }

  // ─── Pass 2: status changes (status_date watermark) ────────────────────────

  private async readStatusChanges(
    cursor: ShoperOrderFeedCursor,
    input: OrderFeedInput,
    lastOrderId: string | null,
    emitted: ReadonlySet<string>,
    timezone: string | null,
  ): Promise<ShoperStatusPassResult> {
    if (cursor.statusWatermark === null) {
      return { items: [], cursor: await this.stampWatermark() };
    }

    const start = cursor.statusPassStart ?? shiftWallClockBack(cursor.statusWatermark, SHOPER_STATUS_LOOKBACK_SECONDS);
    const pagesThisPoll = Math.min(
      MAX_STATUS_PAGES_PER_POLL,
      Math.max(1, Math.ceil(Math.trunc(input.limit) / SHOPER_MAX_PAGE_SIZE)),
    );

    let watermark: string | null = cursor.statusWatermark;
    let page = cursor.statusNextPage ?? 1;
    let complete = false;
    const items: OrderFeedItem[] = [];

    for (let read = 0; read < pagesThisPoll; read += 1) {
      const result = await fetchShoperPage<ShoperOrderRow>(this.client, '/orders', {
        page,
        limit: SHOPER_MAX_PAGE_SIZE,
        query: {
          order: 'status_date ASC',
          filters: JSON.stringify({ status_date: { '>=': start } }),
        },
      });
      for (const row of result.items) {
        if (isWallClock(row.status_date)) {
          watermark = laterWallClock(watermark, row.status_date);
        }
        const item = await this.statusChangeItem(row, lastOrderId, emitted, timezone, input.eventTypes);
        if (item !== null) {
          items.push(item);
        }
      }
      if (result.items.length === 0 || page >= result.pages) {
        complete = true;
        break;
      }
      page += 1;
    }

    return {
      items,
      cursor: complete
        ? { statusWatermark: watermark, statusPassStart: null, statusNextPage: null }
        : // The same `start` next poll, so a pass that spans polls reads one result set.
          { statusWatermark: watermark, statusPassStart: start, statusNextPage: page },
    };
  }

  /**
   * First status pass (or one whose state was lost): take the shop's latest
   * `status_date` as the watermark and enumerate nothing. A missing watermark must
   * never mean "since the beginning", which would re-sync every order the shop has.
   */
  private async stampWatermark(): Promise<ShoperStatusPassState> {
    const latest = await fetchShoperPage<ShoperOrderRow>(this.client, '/orders', {
      page: 1,
      limit: 1,
      query: { order: 'status_date DESC' },
    });
    const value = latest.items[0]?.status_date;
    const watermark = isWallClock(value) ? value : null;
    this.logger.warn(
      `Shoper order feed has no status watermark (connection: ${this.connection.id}); stamping it at ` +
        `${watermark ?? '<no orders yet>'}. Status changes made before this are not re-read by the poll.`,
    );
    return { statusWatermark: watermark, statusPassStart: null, statusNextPage: null };
  }

  private async statusChangeItem(
    row: ShoperOrderRow,
    lastOrderId: string | null,
    emitted: ReadonlySet<string>,
    timezone: string | null,
    eventTypes: OrderFeedEventType[] | undefined,
  ): Promise<OrderFeedItem | null> {
    const id = String(row.order_id);
    if (isOwnOrder(row) || !ORDER_ID.test(id) || emitted.has(id)) {
      return null;
    }
    // Not read by the new-orders pass yet: it will be, with its current status.
    if (lastOrderId === null || Number(id) > Number(lastOrderId)) {
      return null;
    }
    // The status it was placed in: no change since the order was first read.
    if (!isWallClock(row.status_date) || row.status_date === row.date) {
      return null;
    }
    const eventType: OrderFeedEventType = isTerminal(await this.statusOf(row)) ? 'cancelled' : 'updated';
    if (eventTypes !== undefined && !eventTypes.includes(eventType)) {
      return null;
    }
    return {
      externalOrderId: id,
      eventType,
      occurredAt: shopLocalToIso(row.status_date, timezone) ?? new Date(0).toISOString(),
      // The status and its date are in the key: a re-read of the same change dedupes,
      // the next change of the same order is a new event.
      eventKey: `${id}:${eventType}:${String(row.status_id)}@${row.status_date}`,
    };
  }

  // ─── getOrder ──────────────────────────────────────────────────────────────

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

  // ─── OrderStatusWriteback ──────────────────────────────────────────────────

  /** Delegated: the order processor writes the same events the same way (see `ShoperOrderStatusWriter`). */
  write(event: OrderLifecycleEvent): Promise<OrderWritebackResult> {
    return this.statusWriter.write(event);
  }

  // ─── SourceOptionsReader ───────────────────────────────────────────────────
  //
  // Each list's `value` is exactly what `getOrder` stamps on the incoming order,
  // because that is the key a mapping is looked up by: the shipping id
  // (`shipping.methodId`), the payment id (`sourcePaymentMethod`) and the
  // NEUTRAL status (`status`, which the status mapping is keyed on).

  listDeliveryMethods(): Promise<MappingOption[]> {
    return listShoperMappingOptions(this.client, 'shippings');
  }

  listPaymentMethods(): Promise<MappingOption[]> {
    return listShoperMappingOptions(this.client, 'payments');
  }

  /**
   * The neutral statuses Shoper orders arrive in, each labelled with the shop's
   * own statuses that fold into it. Listing the shop's status ids instead would
   * offer keys no order ever carries: the order source reads a status as its
   * neutral meaning, so a mapping keyed on a Shoper id would never apply.
   */
  async listOrderStatuses(): Promise<MappingOption[]> {
    const groups = new Map<string, string[]>();
    for (const status of await this.reference.listStatuses()) {
      const neutral = mapShoperOrderStatus(status);
      const names = groups.get(neutral) ?? [];
      names.push(status.labels[0] ?? `#${status.statusId}`);
      groups.set(neutral, names);
    }
    return [...groups.entries()].map(([neutral, names]) => ({
      value: neutral,
      label: `${NEUTRAL_STATUS_LABEL[neutral] ?? neutral} (Shoper: ${names.join(', ')})`,
    }));
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

function isTerminal(status: ShoperOrderStatusInfo | null): boolean {
  const neutral = mapShoperOrderStatus(status);
  return neutral === 'cancelled' || neutral === 'refunded';
}

/** A page re-read under offset paging can repeat a row; one event per key is enough. */
function dedupeByEventKey(items: readonly OrderFeedItem[]): OrderFeedItem[] {
  const byKey = new Map<string, OrderFeedItem>();
  for (const item of items) {
    if (!byKey.has(item.eventKey)) {
      byKey.set(item.eventKey, item);
    }
  }
  return [...byKey.values()];
}
