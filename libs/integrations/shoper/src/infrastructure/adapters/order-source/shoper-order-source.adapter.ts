/**
 * Shoper Order Source Adapter
 *
 * Implements `OrderSourcePort` for orders placed in a Shoper shop, plus
 * `OrderStatusWriteback` (the lifecycle relay reaches a source-only shop through
 * this capability), `SourceOptionsReader` (the mapping page's source lists) and
 * `OrderFulfillmentReadback` (#3365: what the shop itself says about the order's
 * dispatch, read back after OpenLinker relayed one).
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
 * @implements {OrderFulfillmentReadback}
 * @implements {OrderFeedBootstrap} (#4265) where the feed starts for "only new orders"
 * @implements {OrderFeedDateBootstrap} (#4265) where the feed starts for "from a date"
 * @implements {OrderWindowReader} (#4265) one-off import of a date range, either direction
 */
import type {
  IncomingOrder,
  MappingOption,
  OrderFeedBootstrap,
  OrderFeedDateBootstrap,
  OrderFeedEventType,
  OrderFeedInput,
  OrderFeedItem,
  OrderFeedOutput,
  OrderFulfillmentReadback,
  OrderLifecycleEvent,
  OrderSourcePort,
  OrderStatusWriteback,
  OrderWindowInput,
  OrderWindowPage,
  OrderWindowReader,
  OrderWritebackResult,
  SourceFulfillmentReadback,
  SourceFulfillmentWaybill,
  SourceOptionsReader,
} from '@openlinker/core/orders';
import { OrderSyncStartUnavailableError, unavailableSourceFulfillmentReadback } from '@openlinker/core/orders';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';

import { ShoperApiError } from '../../../domain/exceptions/shoper-api.error';
import { ShoperNetworkError } from '../../../domain/exceptions/shoper-network.error';
import type { ShoperOrderLineRow, ShoperOrderRow, ShoperParcel } from '../../../domain/types/shoper-api.types';
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
import { normalizeTrackingNumber, readShoperDispatched } from '../../mappers/shoper-parcel.mapper';
import { listShoperMappingOptions } from '../../readers/shoper-mapping-options.reader';
import type { ShoperOrderParcels } from '../../readers/shoper-order-parcels.reader';
import { readShoperOrderParcels } from '../../readers/shoper-order-parcels.reader';
import type { ShoperOrderReferenceProvider } from '../../shop-context/shoper-order-reference.provider';
import type { ShoperShopContextProvider } from '../../shop-context/shoper-shop-context.provider';
import type { ShoperParcelShippingRefusalProvider } from '../../shop-context/shoper-parcel-shipping-refusal.provider';
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

export class ShoperOrderSourceAdapter
  implements
    OrderSourcePort,
    OrderStatusWriteback,
    SourceOptionsReader,
    OrderFulfillmentReadback,
    OrderFeedBootstrap,
    OrderFeedDateBootstrap,
    OrderWindowReader
{
  private readonly logger = new Logger(ShoperOrderSourceAdapter.name);
  private readonly statusWriter: ShoperOrderStatusWriter;

  constructor(
    private readonly client: ShoperHttpClient,
    private readonly reference: ShoperOrderReferenceProvider,
    private readonly shopContext: ShoperShopContextProvider,
    private readonly connection: Connection,
    /** Shared with the order processor by the factory; see `ShoperParcelShippingRefusalProvider`. */
    parcelShippingRefusals?: ShoperParcelShippingRefusalProvider,
  ) {
    this.statusWriter = new ShoperOrderStatusWriter(client, connection, reference, parcelShippingRefusals);
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
      const item = await this.toFeedItem(row, timezone);
      rows.push(row);
      if (eventTypes !== undefined && !eventTypes.includes(item.eventType)) {
        continue;
      }
      items.push(item);
    }
    return { items, rows, lastOrderId };
  }

  /**
   * The feed item for a NEW order, shared by the live feed and the window read so
   * both emit the same `eventKey` and one order is never queued twice.
   *
   * A terminal order is reported as `cancelled` even on first sight: core
   * routes that event through the cancellation relay and never through the
   * create/update path, which would mirror an already-dead order to its
   * destinations (the PrestaShop and WooCommerce sources do the same).
   */
  private async toFeedItem(row: ShoperOrderRow, timezone: string | null): Promise<OrderFeedItem> {
    const id = String(row.order_id);
    const eventType: OrderFeedEventType = isTerminal(await this.statusOf(row)) ? 'cancelled' : 'created';
    return {
      externalOrderId: id,
      eventType,
      occurredAt: shopLocalToIso(row.date, timezone) ?? new Date(0).toISOString(),
      eventKey: `${id}:${eventType}`,
    };
  }

  // ─── Order sync start (#4265) ──────────────────────────────────────────────

  /**
   * Cursor of the newest order, with the status watermark stamped too: a head
   * without it would make the first poll stamp it itself, but only AFTER reading
   * from an unset position, and a seeded feed must never look like a first run.
   * The newest order is NOT filtered for our own: the feed advances over them too.
   */
  async headCursor(): Promise<string | null> {
    const head = await fetchShoperPage<ShoperOrderRow>(this.client, '/orders', {
      page: 1,
      limit: 1,
      query: { order: 'order_id DESC' },
    });
    const row = head.items[0];
    if (row === undefined) {
      return null;
    }
    const latestStatusDate = await this.readLatestStatusDate();
    const statusWatermark = laterWallClock(isWallClock(row.status_date) ? row.status_date : null, latestStatusDate);
    return formatShoperFeedCursor({
      lastOrderId: String(row.order_id),
      statusWatermark,
      statusPassStart: null,
      statusNextPage: null,
    });
  }

  /**
   * Cursor positioned just before the first order placed at or after `date`.
   * Shoper dates are naive shop-local, so the bound is compared as the shop's own
   * wall clock with no zone conversion. With no such order the date is in the
   * future of the shop's history, so the feed starts at the head - and on a shop
   * with no orders at all, at "nothing older than now" rather than at the
   * beginning, so an order placed later is the first one read, not a replay of
   * history.
   *
   * Only a refusal the shop will repeat (400/422) becomes the typed "cannot start
   * here"; an auth rejection, a throttle, a 5xx or a network failure is rethrown
   * as it is, so the connection is flagged for re-authentication or the job
   * retries instead of the operator being told the date was refused.
   */
  async cursorForDate(date: string): Promise<string> {
    const day = parseDay(date);
    if (day === null) {
      throw new OrderSyncStartUnavailableError(`"${date}" is not a date Shoper can start order sync from`);
    }
    const bound = `${day} 00:00:00`;
    let first: readonly ShoperOrderRow[];
    try {
      first = (
        await fetchShoperPage<ShoperOrderRow>(this.client, '/orders', {
          page: 1,
          limit: 1,
          query: {
            order: 'order_id ASC',
            filters: JSON.stringify({ date: { '>=': bound } }),
          },
        })
      ).items;
    } catch (error) {
      throw this.asStartRefusal(error, 'filter orders by date');
    }
    const row = first[0];
    if (row === undefined) {
      const head = await this.headCursor();
      if (head !== null) {
        return head;
      }
      return formatShoperFeedCursor({
        lastOrderId: '0',
        statusWatermark: await this.readLatestStatusDate(),
        statusPassStart: null,
        statusNextPage: null,
      });
    }
    // Safety net over a filter that has been seen to work: a shop that ignored it
    // would hand back its oldest order, and starting there silently imports history.
    if (isWallClock(row.date) && row.date < bound) {
      throw new OrderSyncStartUnavailableError(
        `Shoper ignored the date filter (it returned an order from ${row.date} for "from ${day}"); ` +
          'start from "only new orders" or "all" instead',
      );
    }
    const latestStatusDate = await this.readLatestStatusDate();
    return formatShoperFeedCursor({
      // N-1: the feed reads `order_id > cursor`, so the first order of the day is included.
      lastOrderId: String(Math.max(Number(row.order_id) - 1, 0)),
      statusWatermark: latestStatusDate,
      statusPassStart: null,
      statusNextPage: null,
    });
  }

  /**
   * What a failed start read means to the operator. Only HTTP 400/422 - the shop
   * understood and refused the request, and would again - is "this start cannot
   * be honoured". Everything else, 401/403 included, is rethrown untouched:
   * the auth classifier recognises a `ShoperApiError` that `isAuthRejection()`
   * qualifies, and wrapping it would hide the connection's need to re-authenticate.
   */
  private asStartRefusal(error: unknown, what: string): unknown {
    if (error instanceof ShoperApiError && (error.statusCode === 400 || error.statusCode === 422)) {
      return new OrderSyncStartUnavailableError(
        `Shoper refused to ${what} (${error.message}); start from "only new orders" or "all" instead`,
      );
    }
    return error;
  }

  /**
   * One page of orders placed in `[from, to]`, either direction. Keyset on
   * `order_id` (cursor `id:<n>`), so a page boundary never repeats or skips a row;
   * it advances by the raw ids, own orders included, or a page made only of them
   * would stall the import.
   */
  async listOrdersInWindow(input: OrderWindowInput): Promise<OrderWindowPage> {
    const limit = Math.min(Math.max(Math.trunc(input.limit), 1), SHOPER_MAX_PAGE_SIZE);
    const ascending = input.direction === 'oldest-first';
    const position = parseWindowCursor(input.cursor, this.connection.id);

    const filters: Record<string, Record<string, string>> = {};
    if (position !== null) {
      filters.order_id = { [ascending ? '>' : '<']: position };
    }
    const date: Record<string, string> = {};
    if (input.from !== undefined) {
      const from = parseDay(input.from);
      if (from === null) {
        throw new OrderSyncStartUnavailableError(`Shoper order window: "${input.from}" is not a date`);
      }
      date['>='] = `${from} 00:00:00`;
    }
    if (input.to !== undefined) {
      const to = parseDay(input.to);
      if (to === null) {
        throw new OrderSyncStartUnavailableError(`Shoper order window: "${input.to}" is not a date`);
      }
      date['<='] = `${to} 23:59:59`;
    }
    if (Object.keys(date).length > 0) {
      filters.date = date;
    }

    let page: Awaited<ReturnType<typeof fetchShoperPage<ShoperOrderRow>>>;
    try {
      page = await fetchShoperPage<ShoperOrderRow>(this.client, '/orders', {
        page: 1,
        limit,
        query: {
          order: ascending ? 'order_id ASC' : 'order_id DESC',
          ...(Object.keys(filters).length === 0 ? {} : { filters: JSON.stringify(filters) }),
        },
      });
    } catch (error) {
      throw this.asStartRefusal(error, 'read orders in that date range');
    }

    const { timezone } = await this.shopContext.get();
    const zone = timezone ?? null;
    const items: OrderFeedItem[] = [];
    let edge: string | null = position;
    for (const row of page.items) {
      const id = String(row.order_id);
      edge =
        edge === null || (ascending ? Number(id) > Number(edge) : Number(id) < Number(edge)) ? id : edge;
      if (isOwnOrder(row)) {
        continue;
      }
      if (isOutsideWindow(row.date, date)) {
        // The filter has been seen to work; a row it let through is dropped rather
        // than imported, but it still advanced the edge above so the walk ends.
        this.logger.warn(
          `Shoper returned order ${id} dated ${row.date} for a window ${date['>='] ?? '...'} to ` +
            `${date['<='] ?? '...'}; it was skipped (connection: ${this.connection.id})`,
        );
        continue;
      }
      items.push(await this.toFeedItem(row, zone));
    }

    // A short page is the end: Shoper returns fewer rows than asked only when none are left.
    const done = page.items.length < limit || edge === null;
    return { items, nextCursor: done ? null : `id:${edge}`, done };
  }

  private async readLatestStatusDate(): Promise<string | null> {
    const latest = await fetchShoperPage<ShoperOrderRow>(this.client, '/orders', {
      page: 1,
      limit: 1,
      query: { order: 'status_date DESC' },
    });
    const value = latest.items[0]?.status_date;
    return isWallClock(value) ? value : null;
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
    const watermark = await this.readLatestStatusDate();
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

  // ─── OrderFulfillmentReadback (#3365) ──────────────────────────────────────

  /**
   * What the shop says about this order's dispatch: its status and its parcels.
   *
   * `rawStatus` is the order row's own `status_id`, verbatim (`"7"`). The order
   * carries nothing else: the status NAME is the merchant's own word, per
   * language, from a separate table, so it would not be the order's answer and
   * would change whenever the merchant renames a status. The id is stable and
   * is what an operator finds in the shop's status settings.
   *
   * The status TYPE comes from that table (`ShoperOrderReferenceProvider`, the
   * same cached read `getOrder` uses), and `dispatched` is decided by
   * `readShoperDispatched`, the rule the processor's read-back shares. The table
   * read is best-effort: if it fails, the status is reported with its type
   * unknown rather than losing the answer the order read already gave.
   *
   * Waybills come from `/parcels` (a second request, like Allegro's shipments
   * read): one per parcel carrying a `shipping_code`, with the parcel's shipping
   * method as the carrier. That read is best-effort too - a failure, or more
   * parcels than one page holds, reports `waybills: null` ("not reported"),
   * never `[]`, which would claim the shop listed none.
   *
   * Only the ORDER read decides the outcome: when it fails (network, 401, 404,
   * 5xx) the answer is `unavailable`, never a throw, because the caller is a
   * read surface.
   */
  async readFulfillment(input: { externalOrderId: string }): Promise<SourceFulfillmentReadback> {
    const { externalOrderId } = input;
    if (!ORDER_ID.test(externalOrderId)) {
      this.logger.warn(
        `Shoper fulfillment readback refused order id "${externalOrderId}": not a Shoper order id ` +
          `(connection: ${this.connection.id})`,
      );
      return unavailableSourceFulfillmentReadback(`"${externalOrderId}" is not a Shoper order id`);
    }

    let row: ShoperOrderRow;
    try {
      ({ data: row } = await this.client.get<ShoperOrderRow>(`/orders/${externalOrderId}`));
    } catch (error) {
      this.logger.warn(
        `Shoper fulfillment readback failed for order ${externalOrderId} (connection: ${this.connection.id}): ` +
          (error instanceof Error ? error.message : String(error)),
      );
      return unavailableSourceFulfillmentReadback(`Shoper did not answer for order ${externalOrderId}`);
    }
    if (String(row.order_id) !== externalOrderId) {
      this.logger.warn(
        `Shoper returned order ${String(row.order_id)} for ${externalOrderId} (connection: ${this.connection.id})`,
      );
      return unavailableSourceFulfillmentReadback(`Shoper answered with a different order for ${externalOrderId}`);
    }

    const rawStatus = row.status_id === null || row.status_id === undefined ? null : String(row.status_id);
    const [status, parcels] = await Promise.all([
      this.readStatusBestEffort(row),
      this.readParcelsBestEffort(externalOrderId),
    ]);
    const dispatched = readShoperDispatched(status, parcels?.rows ?? null);
    if (dispatched === null && rawStatus !== null) {
      this.logger.warn(
        `shoper_fulfillment_status_unrecognised: Shoper order ${externalOrderId} is in status ${rawStatus}, ` +
          `which could not be read as dispatched or not; reporting it as unknown (connection: ${this.connection.id})`,
      );
    }

    return {
      outcome: 'read',
      rawStatus,
      dispatched,
      waybills: parcels === null || !parcels.complete ? null : await this.toWaybills(parcels.rows),
    };
  }

  private async readStatusBestEffort(row: ShoperOrderRow): Promise<ShoperOrderStatusInfo | null> {
    try {
      return await this.statusOf(row);
    } catch (error) {
      this.logger.debug(
        `Shoper status table unreadable for order ${String(row.order_id)} (connection: ${this.connection.id}): ` +
          (error instanceof Error ? error.message : String(error)),
      );
      return null;
    }
  }

  private async readParcelsBestEffort(
    externalOrderId: string,
  ): Promise<ShoperOrderParcels | null> {
    try {
      return await readShoperOrderParcels(this.client, externalOrderId);
    } catch (error) {
      this.logger.debug(
        `Shoper parcels unreadable for order ${externalOrderId} (connection: ${this.connection.id}): ` +
          (error instanceof Error ? error.message : String(error)),
      );
      return null;
    }
  }

  /**
   * A parcel with no tracking number is skipped rather than carried blank. The
   * carrier name is the shipping method's display name, best-effort: a failed
   * lookup drops the name, never the waybill.
   */
  private async toWaybills(parcels: readonly ShoperParcel[]): Promise<SourceFulfillmentWaybill[]> {
    const waybills: SourceFulfillmentWaybill[] = [];
    for (const parcel of parcels) {
      const waybill = normalizeTrackingNumber(parcel.shipping_code ?? undefined);
      if (waybill === undefined) {
        continue;
      }
      const carrierId =
        parcel.shipping_id === null || parcel.shipping_id === undefined ? undefined : String(parcel.shipping_id);
      const carrierName = carrierId === undefined ? null : await this.shippingNameBestEffort(carrierId);
      waybills.push({
        waybill,
        ...(carrierId === undefined ? {} : { carrierId }),
        ...(carrierName === null ? {} : { carrierName }),
      });
    }
    return waybills;
  }

  private async shippingNameBestEffort(shippingId: string): Promise<string | null> {
    try {
      return await this.reference.getShippingName(shippingId);
    } catch {
      return null;
    }
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

const DAY = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/;

/**
 * The calendar day of a bare date or an ISO instant, as written (no zone
 * conversion), or null. The day must exist: `2026-13-45` and `2026-02-30` are
 * refused here rather than sent to the shop as a filter it may read oddly.
 */
function parseDay(value: string): string | null {
  const match = DAY.exec(value.trim());
  if (match === null) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  const real =
    probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
  return real ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** True when a wall-clock `date` lies outside the filter bounds; an unreadable date is not judged. */
function isOutsideWindow(rowDate: string | null | undefined, bounds: Record<string, string>): boolean {
  if (!isWallClock(rowDate)) {
    return false;
  }
  const lower = bounds['>='];
  const upper = bounds['<='];
  return (lower !== undefined && rowDate < lower) || (upper !== undefined && rowDate > upper);
}

function parseWindowCursor(raw: string | null, connectionId: string): string | null {
  if (raw === null) {
    return null;
  }
  const match = /^id:(\d+)$/.exec(raw);
  if (match === null) {
    throw new RangeError(`Shoper order window cursor is not one this adapter wrote, got "${raw}" (connection: ${connectionId})`);
  }
  return match[1];
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
