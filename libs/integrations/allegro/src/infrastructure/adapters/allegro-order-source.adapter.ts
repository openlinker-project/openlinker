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

import type { OrderSourcePort, SourceOptionsReader, MappingOption } from '@openlinker/core/orders';
import type {
  OrderFeedInput,
  OrderFeedOutput,
  OrderFeedEventType,
  IncomingOrder,
  IncomingOrderAddress,
  OrderShipping,
  OrderPickupPoint,
} from '@openlinker/core/orders';
import { Connection } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import { IAllegroHttpClient } from '../http/allegro-http-client.interface';
import {
  AllegroCheckoutForm,
  AllegroDeliveryMethodsResponse,
  AllegroOrderEventsResponse,
  AllegroShippingRatesResponse,
  AllegroShippingRateDetailResponse,
} from '../../domain/types/allegro-api.types';
import { ALLEGRO_ORDER_STATUS_OPTIONS } from '../../domain/types/allegro-order-status.types';
import { ALLEGRO_PAYMENT_TYPE_OPTIONS } from '../../domain/types/allegro-payment-type.types';

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
export class AllegroOrderSourceAdapter implements OrderSourcePort, SourceOptionsReader {
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

      // #454 — split totals: derive subtotal from line items, shipping from
      // delivery.cost (or fallback). Previously we used `totalToPay` as both
      // subtotal and total, which left PrestaShop with `total_shipping=0` and
      // a `Payment error` reconciliation gap on every Allegro order.
      const subtotal = checkoutForm.lineItems.reduce(
        (acc, item) => acc + Number.parseFloat(item.price.amount) * item.quantity,
        0,
      );
      const total = Number.parseFloat(checkoutForm.summary.totalToPay.amount);
      const shipping = checkoutForm.delivery?.cost
        ? Number.parseFloat(checkoutForm.delivery.cost.amount)
        : Math.max(0, total - subtotal);

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
          name: lineItem.offer.name,
          // imageUrl intentionally omitted — Allegro's checkout-form endpoint
          // does not expose a product image URL. Future enrichment from the
          // internal product catalog is tracked as a separate follow-up.
        })),
        totals: {
          subtotal: roundCurrency(subtotal),
          tax: 0,
          shipping: roundCurrency(shipping),
          total: roundCurrency(total),
          currency: checkoutForm.summary.totalToPay.currency,
        },
        shippingAddress: this.resolveShippingAddress(checkoutForm),
        billingAddress: undefined,
        shipping: this.resolveShipping(checkoutForm),
        pickupPoint: this.resolvePickupPoint(checkoutForm),
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

  /**
   * Resolve the shipping address from the checkout form.
   *
   * Resolution chain:
   *   1. `delivery.address` (#457) — buyer's checkout-time ship-to when present
   *      with real geography.
   *   2. `delivery.pickupPoint.address` (#458) — locker geography for pickup-point
   *      orders, where `delivery.address` is typically empty `{}`.
   *   3. `buyer.address` — the buyer's stored profile address as a final fallback.
   *
   * Empty-object guard for `delivery.address`: Allegro returns `{}` on pickup-point
   * orders (the locker address lives on `delivery.pickupPoint`). Without the guard
   * we'd emit empty strings for every address field — worse than the fallbacks.
   */
  private resolveShippingAddress(
    checkoutForm: AllegroCheckoutForm,
  ): IncomingOrderAddress | undefined {
    const deliveryAddr = checkoutForm.delivery?.address;
    const hasDeliveryAddress = Boolean(
      deliveryAddr && (deliveryAddr.street || deliveryAddr.city || deliveryAddr.zipCode),
    );

    if (hasDeliveryAddress && deliveryAddr) {
      this.logger.debug(
        `Using delivery.address as shippingAddress for ${checkoutForm.id} (connection: ${this.connectionId})`,
      );
      return {
        firstName: deliveryAddr.firstName,
        lastName: deliveryAddr.lastName,
        company: deliveryAddr.companyName,
        address1: deliveryAddr.street ?? '',
        city: deliveryAddr.city ?? '',
        postalCode: deliveryAddr.zipCode ?? '',
        country: deliveryAddr.countryCode ?? '',
        phone: deliveryAddr.phoneNumber,
      };
    }

    const pickupAddr = checkoutForm.delivery?.pickupPoint?.address;
    const hasPickupAddress = Boolean(
      pickupAddr && (pickupAddr.street || pickupAddr.city || pickupAddr.zipCode),
    );
    if (hasPickupAddress && pickupAddr) {
      this.logger.debug(
        `Using delivery.pickupPoint.address as shippingAddress for ${checkoutForm.id} (connection: ${this.connectionId})`,
      );
      // The recipient is still the buyer; only the geography comes from the locker.
      return {
        firstName: checkoutForm.buyer.firstName,
        lastName: checkoutForm.buyer.lastName,
        address1: pickupAddr.street ?? '',
        city: pickupAddr.city ?? '',
        postalCode: pickupAddr.zipCode ?? '',
        country: pickupAddr.countryCode ?? '',
        phone: checkoutForm.buyer.phoneNumber,
      };
    }

    if (checkoutForm.buyer.address) {
      this.logger.debug(
        `Using buyer.address as shippingAddress fallback for ${checkoutForm.id} (connection: ${this.connectionId})`,
      );
      return {
        firstName: checkoutForm.buyer.firstName,
        lastName: checkoutForm.buyer.lastName,
        address1: checkoutForm.buyer.address.street ?? '',
        city: checkoutForm.buyer.address.city ?? '',
        postalCode: checkoutForm.buyer.address.zipCode ?? '',
        country: checkoutForm.buyer.address.countryCode ?? '',
        phone: checkoutForm.buyer.phoneNumber,
      };
    }
    return undefined;
  }

  /**
   * Resolve the source-side shipping reference (#455).
   *
   * Returns `{ methodId, methodName? }` when Allegro provides `delivery.method.id`.
   * Carrier mapping at the destination consumes `methodId`.
   */
  private resolveShipping(checkoutForm: AllegroCheckoutForm): OrderShipping | undefined {
    const method = checkoutForm.delivery?.method;
    if (!method?.id) {
      return undefined;
    }
    return { methodId: method.id, methodName: method.name };
  }

  /**
   * Resolve the pickup-point reference (#458).
   *
   * Returns `{ id, name?, description? }` when Allegro provides `delivery.pickupPoint.id`.
   * Decoupled from `shippingAddress` so it survives address normalization and is
   * greppable for downstream module-aware integrations.
   */
  private resolvePickupPoint(checkoutForm: AllegroCheckoutForm): OrderPickupPoint | undefined {
    const pp = checkoutForm.delivery?.pickupPoint;
    if (!pp?.id) {
      return undefined;
    }
    return { id: pp.id, name: pp.name, description: pp.description };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SourceOptionsReader (#472 / #474)
  //
  // `listOrderStatuses` and `listPaymentMethods` are static lookups — Allegro
  // does not expose live endpoints for these (see the doc-link comments in
  // `allegro-order-status.types.ts` and `allegro-payment-type.types.ts`).
  // `listDeliveryMethods` is the only live one: it walks the seller's rate-
  // tables (`/sale/shipping-rates` + per-id details) and flattens the
  // underlying carrier methods, deduped by methodId.
  // ─────────────────────────────────────────────────────────────────────────

  listOrderStatuses(): Promise<MappingOption[]> {
    return Promise.resolve([...ALLEGRO_ORDER_STATUS_OPTIONS]);
  }

  listPaymentMethods(): Promise<MappingOption[]> {
    return Promise.resolve([...ALLEGRO_PAYMENT_TYPE_OPTIONS]);
  }

  async listDeliveryMethods(): Promise<MappingOption[]> {
    // Step 1: list the seller's rate-tables AND fetch the canonical
    // method catalogue in parallel. The catalogue (`/sale/delivery-methods`)
    // resolves bare method-ids into operator-friendly names (#496) since the
    // rate-table response itself only carries `deliveryMethod.id`, not name.
    const [rateSets, methodsResponse] = await Promise.all([
      this.httpClient.get<AllegroShippingRatesResponse>('/sale/shipping-rates'),
      this.httpClient.get<AllegroDeliveryMethodsResponse>('/sale/delivery-methods'),
    ]);
    const rateSetIds = (rateSets.data.shippingRates ?? []).map((r) => r.id);
    const nameById = new Map<string, string>(
      (methodsResponse.data.deliveryMethods ?? []).map((m) => [m.id, m.name]),
    );

    if (rateSetIds.length === 0) {
      this.logger.warn(
        `Allegro returned no shipping-rates for connection ${this.connectionId} — listDeliveryMethods is empty. Operator likely needs to configure cenniki in the seller portal first.`,
      );
      return [];
    }

    // Step 2: fetch each rate-table's details in parallel. N+1 in the strict
    // sense but bounded — sellers typically have <20 rate-tables, and this is
    // an operator-driven endpoint (called when opening the carrier-mapping UI),
    // not a hot path. Caching is deferred to a follow-up if latency bites.
    const details = await Promise.all(
      rateSetIds.map((id) =>
        this.httpClient.get<AllegroShippingRateDetailResponse>(
          `/sale/shipping-rates/${id}`,
        ),
      ),
    );

    // Step 3: flatten + dedup by methodId. Allegro returns the method object
    // under `deliveryMethod` per developer.allegro.pl/documentation#operation/getShippingRateUsingGET
    // — #494 fixed an earlier `rate.method` typo that silently produced [].
    // Resolve labels via the catalogue (#496); fall back to the rate's own
    // name if present, then the id (defensive — should be rare for properly-
    // configured cenniki).
    const seen = new Map<string, string>();
    for (const detail of details) {
      for (const rate of detail.data.rates ?? []) {
        const id = rate.deliveryMethod?.id;
        if (!id) continue;
        if (!seen.has(id)) {
          seen.set(id, nameById.get(id) ?? rate.deliveryMethod?.name ?? id);
        }
      }
    }
    const result = Array.from(seen.entries()).map(([value, label]) => ({ value, label }));

    // Defensive: if N rate-tables yielded M total rates but zero recognised
    // delivery methods, the API shape has likely regressed (or the parser is
    // looking at the wrong field). Surface it loudly so the next #494-class
    // bug doesn't ship silent.
    if (result.length === 0) {
      const totalRates = details.reduce((n, d) => n + (d.data.rates?.length ?? 0), 0);
      this.logger.warn(
        `Walked ${rateSetIds.length} rate-tables with ${totalRates} rates for connection ${this.connectionId} but produced 0 delivery methods — possible API shape regression.`,
      );
    }
    return result;
  }
}

function mapAllegroEventType(type: string): OrderFeedEventType {
  const t = type.toUpperCase();
  if (t.includes('CANCEL')) return 'cancelled';
  if (t.includes('PAID')) return 'paid';
  if (t.includes('BOUGHT')) return 'created';
  return 'updated';
}

/**
 * Round a number to 2-decimal currency precision.
 *
 * MVP: assumes 2-decimal currencies (PLN, EUR, USD). Allegro PL is the only
 * marketplace today, so PLN coverage is sufficient. Revisit when a non-2-decimal
 * currency surfaces (JPY = 0, BHD = 3, etc.) — likely via an Allegro CZ/SK seller.
 */
function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}
