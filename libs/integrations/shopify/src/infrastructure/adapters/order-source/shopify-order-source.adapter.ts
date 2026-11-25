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
 * Fulfilment readback (`OrderFulfillmentReadback`): a parcel packed in the Shopify
 * admin is reported back, see `readFulfillment`.
 *
 * Refunds: `ShopifyRefundingOrderSourceAdapter` below adds `RefundExecutor` on
 * a connection with `refundsThroughShopify: true` (C20); without it a refund
 * confirmed in OpenLinker is only recorded.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/order-source
 * @implements {OrderSourcePort}
 * @implements {ReturnSourceReader}
 * @implements {SourceOptionsReader}
 * @implements {OrderFulfillmentReadback}
 * @implements {OrderFeedBootstrap}
 * @implements {OrderFeedDateBootstrap}
 * @implements {OrderWindowReader}
 */
import { ShopifyAuthFailureClassifierAdapter } from '../shopify-auth-failure-classifier.adapter';
import type {
  ExecuteRefundCommand,
  IncomingOrder,
  MappingOption,
  OrderFeedEventType,
  OrderFeedInput,
  OrderFeedItem,
  OrderFeedBootstrap,
  OrderFeedDateBootstrap,
  OrderFeedOutput,
  OrderFulfillmentReadback,
  OrderImportDirection,
  OrderWindowInput,
  OrderWindowPage,
  OrderWindowReader,
  OrderSourcePort,
  RefundExecutionResult,
  RefundExecutor,
  ReturnDecliner,
  ReturnSourceReader,
  SourceFulfillmentReadback,
  SourceFulfillmentWaybill,
  SourceOptionsReader,
} from '@openlinker/core/orders';
import { OrderSyncStartUnavailableError, unavailableSourceFulfillmentReadback } from '@openlinker/core/orders';
import type {
  IncomingReturn,
  ReturnDeclineCommand,
  ReturnDeclineResult,
  ReturnFeedInput,
  ReturnFeedItem,
  ReturnFeedOutput,
} from '@openlinker/core/returns';
import { ReturnDeclineRejectedBySourceError } from '@openlinker/core/returns';
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
import {
  APP_ACCESS_SCOPES_QUERY,
  ORDER_BY_ID_QUERY,
  ORDER_FEED_QUERY,
  ORDER_FULFILLMENT_READBACK_QUERY,
  ORDER_LINE_ITEMS_PAGE_QUERY,
  ORDER_WINDOW_QUERY,
  SHOP_TIME_ZONE_QUERY,
} from '../../readers/shopify-order.queries';
import type { ShopifyPaymentGatewayNames } from '../../../domain/types/shopify-config.types';
import { isKnownTimeZone, isRealCalendarDay, zonedDayEdgeToInstant } from '../../../domain/policies/shopify-zoned-time.policy';
import { ShopifyOrderTooLargeException } from '../../../domain/exceptions/shopify-order-too-large.exception';
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
/** The fulfillments read per order; a full page may have been cut off. */
const FULFILLMENTS_PAGE = 20;
/** Without `read_all_orders` Shopify shows only the last 60 days; a day of margin for clock skew. */
const RECENT_ORDERS_HORIZON_MS = 59 * 24 * 60 * 60 * 1000;
const READ_ALL_ORDERS_SCOPE = 'read_all_orders';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const EPOCH = '1970-01-01T00:00:00Z';
/** Orders read per return-feed page; each carries its returns' ids, never their lines. */
const RETURN_FEED_ORDERS_PER_PAGE = 50;
/** Extra 250-line pages read for one order; past this the order is refused rather than ingested partially. */
const MAX_EXTRA_LINE_PAGES = 20;

/**
 * Also an `OrderStatusWriteback`: the lifecycle relay asks the SOURCE participant
 * through its `OrderSource` adapter, so a dispatch on an order that came from
 * Shopify is written back by the same code the destination role uses.
 */
const AUTH_CLASSIFIER = new ShopifyAuthFailureClassifierAdapter();

export class ShopifyOrderSourceAdapter
  implements OrderSourcePort, ReturnSourceReader, ReturnDecliner, OrderStatusWriteback, SourceOptionsReader, OrderFulfillmentReadback,
    OrderFeedBootstrap, OrderFeedDateBootstrap, OrderWindowReader
{
  /** Shopify's own `ReturnDeclineReason` values; core treats them as opaque. */
  readonly declineReasonCodes: readonly string[] = ['RETURN_PERIOD_ENDED', 'FINAL_SALE', 'OTHER'];

  private readonly logger = new Logger(ShopifyOrderSourceAdapter.name);
  private readonly options: ShopifyMappingOptionsReader;
  private canReadAllOrders: Promise<boolean | null> | null = null;
  private warnedOldOrdersHidden = false;
  private shopTimeZone: Promise<string> | null = null;

  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly storeDomain: string,
    private readonly connection: Connection,
    private readonly writeback: OrderStatusWriteback,
    private readonly paymentGateways: ShopifyPaymentGatewayNames = {},
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

  /**
   * What this shop says about the order's fulfilment, so a parcel packed in
   * the Shopify admin reaches OpenLinker.
   *
   * `rawStatus` is the order's `displayFulfillmentStatus` verbatim. `dispatched`
   * is `true` only when Shopify says the WHOLE order is FULFILLED and it is not
   * cancelled: a PARTIALLY_FULFILLED order is `false`, because part of an order
   * having left is not a dispatch to relay to the marketplace (the sync acts on
   * `dispatched: true` alone). A status this code does not know is `null`.
   *
   * Waybills are the tracking numbers of the live (`SUCCESS`) fulfillments, with
   * the carrier name Shopify holds. They are reported for a partial fulfilment
   * too, so an operator sees the parcel. A fulfillment page that may have been
   * cut off reports `waybills: null` ("not reported"), never a short list.
   *
   * A marketplace-side failure is `unavailable`, never a throw.
   */
  async readFulfillment(input: { externalOrderId: string }): Promise<SourceFulfillmentReadback> {
    const { externalOrderId } = input;
    if (!/^\d+$/.test(externalOrderId)) {
      return unavailableSourceFulfillmentReadback(`"${externalOrderId}" is not a Shopify order id`);
    }
    let order: ShopifyFulfillmentReadbackOrder | null;
    try {
      ({ order } = await this.client.query<{ order: ShopifyFulfillmentReadbackOrder | null }>(
        ORDER_FULFILLMENT_READBACK_QUERY,
        { id: toShopifyGid('Order', externalOrderId) },
      ));
    } catch (error) {
      this.logger.warn(
        `Shopify fulfillment readback failed for order ${externalOrderId} (connection: ${this.connection.id}): ` +
          (error instanceof Error ? error.message : String(error)),
      );
      return unavailableSourceFulfillmentReadback(`Shopify did not answer for order ${externalOrderId}`);
    }
    if (order === null) {
      return unavailableSourceFulfillmentReadback(`Shopify has no order ${externalOrderId}`);
    }

    const cancelled = order.cancelledAt !== null;
    const rawStatus = cancelled ? 'CANCELLED' : order.displayFulfillmentStatus;
    const dispatched = cancelled ? false : dispatchedFromDisplayStatus(order.displayFulfillmentStatus);
    if (dispatched === null) {
      this.logger.warn(
        `shopify_fulfillment_status_unrecognised: order ${externalOrderId} is ${order.displayFulfillmentStatus}, ` +
          `reported as unknown (connection: ${this.connection.id})`,
      );
    }
    return {
      outcome: 'read',
      rawStatus,
      dispatched,
      waybills: order.fulfillments.length >= FULFILLMENTS_PAGE ? null : toWaybills(order.fulfillments),
    };
  }

  async listOrderFeed(input: OrderFeedInput): Promise<OrderFeedOutput> {
    const cursor = parseShopifyFeedCursor(input.fromCursor, this.connection.id);
    if (cursor.updatedAt === null) {
      // An empty cursor (null, empty or blank) is the whole history, which includes a
      // connection that predates the start choice. Refusing here would fail every poll
      // for such a connection, so the missing scope is reported, not thrown; the
      // explicit import (listOrdersInWindow) still refuses.
      await this.warnIfOldOrdersHidden();
    }
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

  /**
   * Cursor of the newest order (by `updatedAt`), so a connection that starts
   * "from now" ingests nothing older. an empty shop gets a "now" cursor;
   * a failed read throws, because seeding from nothing would import history.
   * A head still inside the settle window is a safe seed: the feed's keyset
   * resumes strictly after it.
   */
  async headCursor(): Promise<string | null> {
    const data: { orders: ShopifyConnection<ShopifyOrderFeedRow> } = await this.client.query(ORDER_FEED_QUERY, {
      first: 1,
      reverse: true,
    });
    const head = data.orders.nodes[0];
    if (head === undefined) {
      // An empty shop still gets a position (nothing older than now), never null: a null
      // cursor reads as "the whole history" and would demand the read_all_orders scope.
      return formatShopifyFeedCursor({ updatedAt: new Date().toISOString(), orderId: '0' });
    }
    return formatShopifyFeedCursor({
      updatedAt: new Date(head.updatedAt).toISOString(),
      orderId: fromShopifyGid(head.id),
    });
  }

  /**
   * A feed cursor at the start of `date` (a bare day starts at midnight in the
   * SHOP'S time zone; an ISO instant is kept as given), with id 0 so every real
   * order at that instant sorts after it. It refuses a date the shop would not
   * show.
   *
   * Known difference from `listOrdersInWindow`: this seed is a position in the
   * live feed, which is a keyset over `updated_at` (the only key Shopify can
   * sort and resume on without losing orders), while the window filters on
   * `created_at`. An order placed before `date` but changed after it is
   * therefore ingested by a seed at `date` and not by a window starting there.
   * Both honour the same day boundary; only the date field they test differs.
   */
  async cursorForDate(date: string): Promise<string> {
    const instant = await this.startOfDay(date);
    await this.assertOldOrdersReadable(instant);
    return ['v1', instant, '0'].join('|');
  }

  /**
   * Orders placed inside [from, to] by placement date, newest or oldest first.
   * The cursor is Shopify's own `endCursor`, which is stable for one query; the
   * bounds are passed again on every call; a bare day is read in the shop's time
   * zone. No settle window here: a window
   * read is a snapshot of history, not a live feed. Items carry the feed's
   * `eventKey`, so an order imported here and seen by the feed ingests once.
   */
  async listOrdersInWindow(input: OrderWindowInput): Promise<OrderWindowPage> {
    const from = input.from === undefined ? null : await this.startOfDay(input.from);
    const to = input.to === undefined ? null : await this.endOfDay(input.to);
    if (from === null || Date.parse(from) < Date.now() - RECENT_ORDERS_HORIZON_MS) {
      await this.assertOldOrdersReadable(from);
    }
    const filters: string[] = [];
    if (from !== null) {
      filters.push(`created_at:>='${from}'`);
    }
    if (to !== null) {
      filters.push(`created_at:<='${to}'`);
    }
    const data: { orders: ShopifyConnection<ShopifyOrderFeedRow> } = await this.client.query(ORDER_WINDOW_QUERY, {
      first: Math.min(Math.max(1, input.limit), FEED_PAGE_SIZE),
      after: input.cursor,
      query: filters.length === 0 ? null : filters.join(' '),
      reverse: this.isNewestFirst(input.direction),
    });
    const items = data.orders.nodes.map((row): OrderFeedItem => {
      const orderId = fromShopifyGid(row.id);
      return {
        externalOrderId: orderId,
        eventType: this.eventTypeOf(row),
        occurredAt: row.updatedAt,
        eventKey: `${orderId}:${row.updatedAt}`,
      };
    });
    const endCursor = data.orders.pageInfo?.endCursor ?? null;
    const done = data.orders.pageInfo?.hasNextPage !== true || endCursor === null;
    return { items, nextCursor: done ? null : endCursor, done };
  }

  private isNewestFirst(direction: OrderImportDirection): boolean {
    return direction === 'newest-first';
  }

  private async startOfDay(date: string): Promise<string> {
    return this.dayEdge(date, 'start');
  }

  private async endOfDay(date: string): Promise<string> {
    return this.dayEdge(date, 'end');
  }

  /** A bare day in the shop's zone; anything else is an instant and is kept. */
  private async dayEdge(date: string, edge: 'start' | 'end'): Promise<string> {
    if (!DATE_ONLY.test(date)) {
      return this.toInstant(date, date);
    }
    if (!isRealCalendarDay(date)) {
      throw new OrderSyncStartUnavailableError(
        `"${date}" is not a real calendar day (connection: ${this.connection.id})`,
      );
    }
    const instant = zonedDayEdgeToInstant(date, edge, await this.readShopTimeZone());
    if (instant === null) {
      throw new OrderSyncStartUnavailableError(
        `"${date}" is not a date Shopify can be asked about (connection: ${this.connection.id})`,
      );
    }
    return instant;
  }

  /** The shop's IANA zone, read once per adapter; UTC with a warning when it cannot be read. */
  private readShopTimeZone(): Promise<string> {
    this.shopTimeZone ??= this.loadShopTimeZone();
    return this.shopTimeZone;
  }

  private async loadShopTimeZone(): Promise<string> {
    try {
      const data = await this.client.query<{ shop: { ianaTimezone: string | null } | null }>(
        SHOP_TIME_ZONE_QUERY,
        {},
      );
      const zone = data.shop?.ianaTimezone;
      if (typeof zone === 'string' && isKnownTimeZone(zone)) {
        return zone;
      }
      this.logger.warn(
        `shopify_time_zone_unreadable: the shop reported no usable time zone ("${String(zone)}"); a date ` +
          `without a time is read as UTC (connection: ${this.connection.id})`,
      );
    } catch (error) {
      this.logger.warn(
        `shopify_time_zone_unreadable: could not read the shop time zone; a date without a time is read as ` +
          `UTC (connection: ${this.connection.id}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return 'UTC';
  }

  private toInstant(iso: string, original: string): string {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) {
      throw new OrderSyncStartUnavailableError(
        `"${original}" is not a date Shopify can be asked about (connection: ${this.connection.id})`,
      );
    }
    return new Date(ms).toISOString();
  }

  /**
   * Polling path. An app without `read_all_orders` sees only the last 60 days,
   * which a cursor-less poll cannot avoid, so this warns once per adapter and
   * keeps polling rather than refusing (a legacy connection may still hold a
   * null cursor). A scope check that cannot be read throws a plain retryable
   * error and clears the cached answer, so the next poll asks again.
   */
  private async warnIfOldOrdersHidden(): Promise<void> {
    this.canReadAllOrders ??= this.readsAllOrders();
    const allowed = await this.canReadAllOrders;
    if (allowed === null) {
      // A plain Error, not the typed refusal: nothing here is the operator's to fix, so the
      // poll is retried instead of ending as a business failure.
      this.canReadAllOrders = null;
      throw new Error(
        `Could not check the ${READ_ALL_ORDERS_SCOPE} scope for the order feed (connection: ${this.connection.id})`,
      );
    }
    if (allowed === false && !this.warnedOldOrdersHidden) {
      this.warnedOldOrdersHidden = true;
      this.logger.warn(
        `shopify_feed_history_truncated: the app lacks ${READ_ALL_ORDERS_SCOPE}, so this feed ` +
          `shows only the last 60 days (connection: ${this.connection.id})`,
      );
    }
  }

  /**
   * Explicit-import path (`listOrdersInWindow`, `startCursorAt`). Shopify shows
   * only the last 60 days to an app without `read_all_orders`, so an older start
   * would silently import less than asked. Refused when the scope is missing,
   * and also when it cannot be read: an import that may be silently cut to 60
   * days is worse than one that stops and says why. The answer is kept per
   * adapter, so a job asks once, not once per page.
   */
  private async assertOldOrdersReadable(from: string | null): Promise<void> {
    if (from !== null && Date.parse(from) >= Date.now() - RECENT_ORDERS_HORIZON_MS) {
      return;
    }
    this.canReadAllOrders ??= this.readsAllOrders();
    const allowed = await this.canReadAllOrders;
    if (allowed === null) {
      throw new OrderSyncStartUnavailableError(
        `Could not check whether this app may read orders older than 60 days (the ${READ_ALL_ORDERS_SCOPE} ` +
          `scope), so the import was not started. Try again; if it keeps failing, reconnect the shop ` +
          `(connection: ${this.connection.id})`,
      );
    }
    if (allowed === false) {
      throw new OrderSyncStartUnavailableError(
        `Shopify shows an app only the last 60 days of orders without the ${READ_ALL_ORDERS_SCOPE} scope, ` +
          `so orders older than that cannot be imported. Grant the scope to the app and reconnect ` +
          `(connection: ${this.connection.id})`,
      );
    }
  }

  private async readsAllOrders(): Promise<boolean | null> {
    try {
      const data = await this.client.query<{
        currentAppInstallation: { accessScopes: ReadonlyArray<{ handle: string }> } | null;
      }>(APP_ACCESS_SCOPES_QUERY, {});
      const scopes = data.currentAppInstallation?.accessScopes;
      if (scopes === undefined) {
        return null;
      }
      return scopes.some((scope) => scope.handle === READ_ALL_ORDERS_SCOPE);
    } catch (error) {
      if (AUTH_CLASSIFIER.isCredentialRejected(error)) {
        // A revoked or expired token must reach the host's auth classifier so the
        // connection moves to needs_reauth, not be reported as a failed start check.
        throw error;
      }
      this.logger.warn(
        `Could not read the granted scopes to check ${READ_ALL_ORDERS_SCOPE}; an import reaching back more than ` +
          `60 days is refused (connection: ${this.connection.id}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async getOrder(input: { externalOrderId: string }): Promise<IncomingOrder> {
    const data = await this.client.query<{ order: ShopifyOrder | null }>(ORDER_BY_ID_QUERY, {
      id: toShopifyGid('Order', input.externalOrderId),
    });
    if (data.order === null) {
      throw new ShopifyOrderNotFoundException(input.externalOrderId, this.connection.id);
    }
    if (data.order.shippingLines.pageInfo?.hasNextPage === true) {
      throw new ShopifyOrderTooLargeException(input.externalOrderId, 'shipping lines', this.connection.id);
    }
    const order = await this.withAllLines(data.order, input.externalOrderId);
    if (order.presentmentCurrencyCode !== order.currencyCode) {
      // Every figure is read in the shop's currency (the one the rest of this
      // connection uses); the buyer paid in another, so the amounts differ.
      this.logger.warn(
        `Shopify order ${input.externalOrderId} was paid in ${order.presentmentCurrencyCode}; ` +
          `it is ingested in the shop currency ${order.currencyCode} (connection: ${this.connection.id})`,
      );
    }
    const incoming = mapShopifyOrderToIncoming(order, {
      adminOrderUrl:
        `https://admin.shopify.com/store/${shopifyStoreHandle(this.storeDomain)}` +
        `/orders/${input.externalOrderId}`,
      paymentGateways: this.paymentGateways,
    });
    const unrecognised = incoming.metadata?.['unrecognisedUnpaidGateway'];
    if (typeof unrecognised === 'string') {
      this.logger.warn(
        `Shopify order ${input.externalOrderId} is unpaid and its payment method "${unrecognised}" is not ` +
          `recognised, so it is ingested without an amount to collect. If it is cash on delivery, add the name ` +
          `to the connection's codGatewayNames (connection: ${this.connection.id})`,
      );
    }
    return incoming;
  }

  /**
   * The order with every line on it. The first 250 come with the order; the
   * rest are paged here, because an order missing lines is a wrong order, not
   * a smaller one.
   */
  private async withAllLines(order: ShopifyOrder, externalOrderId: string): Promise<ShopifyOrder> {
    let pageInfo = order.lineItems.pageInfo;
    if (pageInfo?.hasNextPage !== true) {
      return order;
    }
    const nodes = [...order.lineItems.nodes];
    for (let page = 0; pageInfo?.hasNextPage === true; page += 1) {
      if (page >= MAX_EXTRA_LINE_PAGES || !pageInfo.endCursor) {
        throw new ShopifyOrderTooLargeException(externalOrderId, 'lines', this.connection.id);
      }
      const next: { order: { lineItems: ShopifyOrder['lineItems'] } | null } = await this.client.query<{
        order: { lineItems: ShopifyOrder['lineItems'] } | null;
      }>(
        ORDER_LINE_ITEMS_PAGE_QUERY,
        { id: toShopifyGid('Order', externalOrderId), after: pageInfo.endCursor },
      );
      if (next.order === null) {
        throw new ShopifyOrderNotFoundException(externalOrderId, this.connection.id);
      }
      nodes.push(...next.order.lineItems.nodes);
      pageInfo = next.order.lineItems.pageInfo;
    }
    return { ...order, lineItems: { nodes } };
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
      const refusal = new ShopifyUserErrorsException('returnDeclineRequest', errors);
      // A throttle clears by itself, so it stays platform-native and in doubt;
      // any other userErrors answer is Shopify deterministically refusing the
      // request (a return not REQUESTED, a bad reason), which a retry cannot
      // turn into a success and core must record as a refusal, not a 500.
      if (refusal.isRateLimited()) {
        throw refusal;
      }
      throw new ReturnDeclineRejectedBySourceError(
        command.externalReturnId,
        errors.map((e) => e.message).join('; ').slice(0, 500),
      );
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
    paymentGateways: ShopifyPaymentGatewayNames = {},
  ) {
    super(client, storeDomain, connection, writeback, paymentGateways);
  }

  executeRefund(command: ExecuteRefundCommand): Promise<RefundExecutionResult> {
    return this.refunds.executeRefund(command);
  }
}

interface ShopifyFulfillmentReadbackOrder {
  readonly cancelledAt: string | null;
  readonly displayFulfillmentStatus: string;
  readonly fulfillments: ReadonlyArray<{
    readonly status: string;
    readonly trackingInfo: ReadonlyArray<{ readonly number: string | null; readonly company: string | null }>;
  }>;
}

/** Whole-order dispatch only: `null` for a status this code does not know. */
function dispatchedFromDisplayStatus(status: string): boolean | null {
  switch (status) {
    case 'FULFILLED':
      return true;
    case 'UNFULFILLED':
    case 'PARTIALLY_FULFILLED':
    case 'IN_PROGRESS':
    case 'ON_HOLD':
    case 'SCHEDULED':
    case 'PENDING_FULFILLMENT':
    case 'OPEN':
    case 'REQUEST_DECLINED':
    case 'RESTOCKED':
      return false;
    default:
      return null;
  }
}

/** Live fulfillments only (a CANCELLED one never shipped); a blank number is skipped; a repeat is listed once. */
function toWaybills(
  fulfillments: ShopifyFulfillmentReadbackOrder['fulfillments'],
): SourceFulfillmentWaybill[] {
  const seen = new Set<string>();
  const waybills: SourceFulfillmentWaybill[] = [];
  for (const fulfillment of fulfillments) {
    if (fulfillment.status !== 'SUCCESS') {
      continue;
    }
    for (const info of fulfillment.trackingInfo) {
      const waybill = info.number?.trim() ?? '';
      if (waybill === '' || seen.has(waybill)) {
        continue;
      }
      seen.add(waybill);
      const carrierName = info.company?.trim() ?? '';
      waybills.push({ waybill, ...(carrierName === '' ? {} : { carrierName }) });
    }
  }
  return waybills;
}
