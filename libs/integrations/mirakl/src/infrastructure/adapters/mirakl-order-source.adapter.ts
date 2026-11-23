/**
 * Mirakl Order Source Adapter
 *
 * `OrderSourcePort` over Mirakl OR11 (`GET /api/orders`). Mirakl offers sellers
 * no webhooks and no change journal, so the feed is a poll over closed
 * `last_updated_date` windows (`mirakl-order-feed.policy.ts`).
 *
 * **This read path writes.** Before reading a page, `listOrderFeed` accepts
 * every order waiting for acceptance (OR21) unless the connection sets
 * `orderAcceptance: 'off'`. It is done here deliberately:
 *
 * - On Mirakl an order is not an order until the seller accepts each line, and
 *   it lapses after the operator's deadline (5 days on Empik). Every other
 *   source delivers orders already accepted, so core has no step for it.
 * - The orders poll is the only thing that ever sees a new Mirakl order, so
 *   accepting there is the one place that cannot be skipped.
 * - An accepted order changes `last_updated_date` and so comes back through the
 *   feed itself on this or the next poll; nothing else needs to remember it.
 *
 * A stock-checked or manual acceptance needs a core sub-capability and a job
 * type of its own; that is a follow-up, not this adapter.
 *
 * Orders still in `STAGING` or `WAITING_ACCEPTANCE` are never part of the feed.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 * @implements {OrderSourcePort}
 */
import type {
  IncomingOrder,
  OrderFeedInput,
  OrderFeedItem,
  OrderFeedOutput,
  OrderSourcePort,
} from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';
import { MiraklApiException } from '../../domain/exceptions/mirakl-api.exception';
import {
  buildFeedEventKey,
  computeFeedWindow,
  deriveFeedEventType,
  halveFeedWindow,
  INGESTIBLE_ORDER_STATES,
  type MiraklFeedWindow,
} from '../../domain/policies/mirakl-order-feed.policy';
import type { MiraklOrderAcceptance } from '../../domain/types/mirakl-connection.types';
import type { MiraklOrder } from '../../domain/types/mirakl-order.types';
import type { IMiraklHttpClient } from '../http/mirakl-http-client.interface';
import { listAllOffset, MIRAKL_MAX_PAGE_SIZE } from '../http/mirakl-pagination';
import { MiraklOrderAcceptor } from './mirakl-order-acceptor';
import { mapMiraklOrderToIncomingOrder } from './mirakl-order.mapper';

const ORDERS_PATH = '/api/orders';
/**
 * How often a window that does not fit the page budget is halved. Sixteen
 * halvings take the 7-day bootstrap window under a minute; past that the read
 * advances anyway and says so.
 */
const MAX_WINDOW_HALVINGS = 16;

export class MiraklOrderSourceAdapter implements OrderSourcePort {
  private readonly logger = new Logger(MiraklOrderSourceAdapter.name);

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IMiraklHttpClient,
    private readonly acceptance: MiraklOrderAcceptance,
    private readonly now: () => Date = (): Date => new Date(),
  ) {}

  async listOrderFeed(input: OrderFeedInput): Promise<OrderFeedOutput> {
    if (this.acceptance === 'auto') {
      await new MiraklOrderAcceptor(this.connectionId, this.httpClient).acceptWaitingOrders();
    }

    const maxPages = Math.max(1, Math.ceil(input.limit / MIRAKL_MAX_PAGE_SIZE));
    let window = computeFeedWindow(input.fromCursor, this.now());
    let orders = await this.readWindow(window, maxPages);
    for (let halvings = 0; orders.truncated && halvings < MAX_WINDOW_HALVINGS; halvings++) {
      window = halveFeedWindow(window);
      orders = await this.readWindow(window, maxPages);
    }
    if (orders.truncated) {
      this.logger.error(
        `Order feed on connection ${this.connectionId} still did not fit ${maxPages} page(s) ` +
          `after ${MAX_WINDOW_HALVINGS} halvings (window ${window.from.toISOString()} - ` +
          `${window.to.toISOString()}); advancing past it, so orders in it may be missed`,
      );
    }

    return {
      items: this.toFeedItems(orders.items, window, input.eventTypes),
      nextCursor: window.to.toISOString(),
    };
  }

  async getOrder(input: { externalOrderId: string }): Promise<IncomingOrder> {
    const { data } = await this.httpClient.get<{ orders?: MiraklOrder[] }>(ORDERS_PATH, {
      queryParams: { order_ids: input.externalOrderId },
    });
    const order = (data?.orders ?? []).find((candidate) => candidate.order_id === input.externalOrderId);
    if (!order) {
      throw new MiraklApiException(
        `Mirakl order ${input.externalOrderId} not found`,
        404,
        'ORDER_NOT_FOUND',
      );
    }
    return mapMiraklOrderToIncomingOrder(order);
  }

  private readWindow(
    window: MiraklFeedWindow,
    maxPages: number,
  ): Promise<{ items: MiraklOrder[]; truncated: boolean }> {
    return listAllOffset<MiraklOrder>(this.httpClient, ORDERS_PATH, {
      itemsKey: 'orders',
      maxPages,
      queryParams: {
        order_state_codes: INGESTIBLE_ORDER_STATES.join(','),
        start_update_date: window.from.toISOString(),
        end_update_date: window.to.toISOString(),
      },
    });
  }

  private toFeedItems(
    orders: readonly MiraklOrder[],
    window: MiraklFeedWindow,
    eventTypes: OrderFeedInput['eventTypes'],
  ): OrderFeedItem[] {
    const items: OrderFeedItem[] = [];
    const seen = new Set<string>();
    for (const order of orders) {
      if (!order.order_id) {
        this.logger.warn(`Skipping an order without order_id on connection ${this.connectionId}`);
        continue;
      }
      const eventKey = buildFeedEventKey(order.order_id, order.last_updated_date, order.created_date);
      const eventType = deriveFeedEventType(order.order_state);
      // Offset paging over a set that changes while it is read can return an
      // order twice; one event per change is enough.
      if (seen.has(eventKey) || (eventTypes && !eventTypes.includes(eventType))) {
        continue;
      }
      seen.add(eventKey);
      items.push({
        externalOrderId: order.order_id,
        eventType,
        occurredAt: order.last_updated_date ?? window.to.toISOString(),
        eventKey,
        eventId: eventKey,
      });
    }
    return items;
  }
}
