/**
 * Allegro Order Source Adapter
 *
 * Implements `OrderSourcePort` for Allegro. Handles incremental order-event
 * ingestion from Allegro's order-events journal and full-order hydration via
 * the checkout-form endpoint. Split out of the legacy `AllegroMarketplaceAdapter`
 * as part of #328.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 * @implements {OrderSourcePort}
 */

import type { OrderSourcePort } from '@openlinker/core/orders';
import type {
  OrderFeedInput,
  OrderFeedOutput,
  OrderFeedEventType,
  IncomingOrder,
} from '@openlinker/core/orders';
import { Connection } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import { IAllegroHttpClient } from '../http/allegro-http-client.interface';
import { AllegroCheckoutForm, AllegroOrderEventsResponse } from '../../domain/types/allegro-api.types';

type OrderFeedItem = OrderFeedOutput['items'][number];

/**
 * Allegro Order Source Adapter
 *
 * Shares the Allegro HTTP client with its sibling `AllegroOfferManagerAdapter`
 * through the per-connection factory (`AllegroAdapterFactory.createAdapters`) —
 * each connection gets one HTTP client instance that both adapters hold by
 * reference. Identifier mapping for ingested orders happens downstream in
 * `OrderIngestionService` against the `IncomingOrder` payload, so the adapter
 * does not need the identifier-mapping port itself.
 */
export class AllegroOrderSourceAdapter implements OrderSourcePort {
  private readonly logger = new Logger(AllegroOrderSourceAdapter.name);

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IAllegroHttpClient,
    _connection: Connection,
  ) {
    void _connection;
  }

  /**
   * List incremental order feed items from Allegro's order-events journal.
   *
   * Uses cursor-based pagination; cursor is the Allegro-assigned event ID
   * (opaque to the caller, monotonic per seller).
   */
  async listOrderFeed(input: OrderFeedInput): Promise<OrderFeedOutput> {
    this.logger.debug(
      `Listing Allegro order feed (connection: ${this.connectionId}, fromCursor: ${input.fromCursor || 'none'}, limit: ${input.limit})`,
    );

    try {
      const queryParams: Record<string, string | number> = {};
      if (input.fromCursor) {
        queryParams.from = input.fromCursor;
      }
      queryParams.limit = input.limit;

      const response = await this.httpClient.get<AllegroOrderEventsResponse>('/order/events', {
        queryParams,
      });

      this.logger.debug(
        `Allegro /order/events raw response (connection: ${this.connectionId}): ${JSON.stringify(response.data)}`,
      );

      const events = response.data.events || [];

      // Determine nextCursor:
      // 1. Use lastEventId from API if provided (most reliable)
      // 2. Fall back to last event's ID if events exist
      // 3. If no events and no lastEventId, keep the current cursor so the
      //    cursor does not get stuck when Allegro returns empty results.
      const nextCursor =
        response.data.lastEventId ||
        (events.length > 0 ? events[events.length - 1]?.id : input.fromCursor || null);

      this.logger.debug(
        `Fetched ${events.length} order events (connection: ${this.connectionId}, nextCursor: ${nextCursor || 'none'})`,
      );

      // Deduplicate by checkoutFormId, keeping the latest event (highest ID).
      const eventMap = new Map<string, (typeof events)[number]>();
      for (const event of events) {
        const checkoutFormId = event.order.checkoutForm.id;
        const existing = eventMap.get(checkoutFormId);
        if (!existing || event.id > existing.id) {
          eventMap.set(checkoutFormId, event);
        }
      }

      const items: OrderFeedItem[] = Array.from(eventMap.values())
        .map((event) => {
          const externalOrderId = event.order.checkoutForm.id;
          const occurredAt = event.occurredAt;
          const eventType = mapAllegroEventType(event.type);

          return {
            externalOrderId,
            eventType,
            occurredAt,
            eventKey: event.id,
            eventId: event.id,
            raw: { type: event.type },
          };
        })
        .filter((i) => !input.eventTypes || input.eventTypes.includes(i.eventType));

      return {
        items,
        nextCursor,
      };
    } catch (error) {
      this.logger.error(
        `Failed to list Allegro order feed (connection: ${this.connectionId}): ${(error as Error).message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Hydrate a full order by Allegro-native checkout form id.
   *
   * Returns an `IncomingOrder` with the raw buyer details; identifier mapping
   * and identity resolution happen downstream in `OrderIngestionService`.
   */
  async getOrder(input: { externalOrderId: string }): Promise<IncomingOrder> {
    const checkoutFormId = input.externalOrderId;
    this.logger.debug(
      `Fetching Allegro order by checkout form ID: ${checkoutFormId} (connection: ${this.connectionId})`,
    );

    try {
      const response = await this.httpClient.get<AllegroCheckoutForm>(
        `/order/checkout-forms/${checkoutFormId}`,
      );

      const checkoutForm = response.data;

      const status = checkoutForm.payment.finishedAt ? 'processing' : 'pending';
      const createdAt = checkoutForm.createdAt ?? new Date().toISOString();
      const updatedAt = checkoutForm.updatedAt ?? createdAt;

      return {
        externalOrderId: checkoutFormId,
        orderNumber: checkoutFormId,
        status,
        customerExternalId: checkoutForm.buyer.id,
        customerEmail: checkoutForm.buyer.email,
        items: checkoutForm.lineItems.map((lineItem) => ({
          id: lineItem.id,
          productRef: { type: 'offer', externalId: lineItem.offer.id },
          quantity: lineItem.quantity,
          price: Number.parseFloat(lineItem.price.amount),
          sku: lineItem.offer.id,
        })),
        totals: {
          subtotal: Number.parseFloat(checkoutForm.summary.totalToPay.amount),
          tax: 0,
          shipping: 0,
          total: Number.parseFloat(checkoutForm.summary.totalToPay.amount),
          currency: checkoutForm.summary.totalToPay.currency,
        },
        shippingAddress: checkoutForm.buyer.address
          ? {
              firstName: checkoutForm.buyer.firstName,
              lastName: checkoutForm.buyer.lastName,
              address1: checkoutForm.buyer.address.street ?? '',
              city: checkoutForm.buyer.address.city ?? '',
              postalCode: checkoutForm.buyer.address.zipCode ?? '',
              country: checkoutForm.buyer.address.countryCode ?? '',
              phone: checkoutForm.buyer.phoneNumber,
            }
          : undefined,
        billingAddress: undefined,
        createdAt,
        updatedAt,
        metadata: {
          buyer: {
            email: checkoutForm.buyer.email,
            login: checkoutForm.buyer.login,
          },
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch Allegro order ${checkoutFormId} (connection: ${this.connectionId}): ${(error as Error).message}`,
        error,
      );
      throw error;
    }
  }
}

function mapAllegroEventType(type: string): OrderFeedEventType {
  const t = type.toUpperCase();
  if (t.includes('CANCEL')) return 'cancelled';
  if (t.includes('PAID')) return 'paid';
  if (t.includes('BOUGHT')) return 'created';
  return 'updated';
}
