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

import type {
  OrderSourcePort,
  SourceOptionsReader,
  OrderDispatchNotifier,
  DispatchCarrierHint,
  MappingOption,
} from '@openlinker/core/orders';
import type {
  OrderFeedInput,
  OrderFeedOutput,
  OrderFeedEventType,
  IncomingOrder,
  IncomingOrderAddress,
  OrderShipping,
  OrderPickupPoint,
  OrderDispatchWindow,
} from '@openlinker/core/orders';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import type { IAllegroHttpClient } from '../http/allegro-http-client.interface';
import type {
  AllegroCheckoutForm,
  AllegroDeliveryMethodsResponse,
  AllegroOrderEventsResponse,
  AllegroShippingRatesResponse,
  AllegroShippingRateDetailResponse,
} from '../../domain/types/allegro-api.types';
import { ALLEGRO_ORDER_STATUS_OPTIONS } from '../../domain/types/allegro-order-status.types';
import { ALLEGRO_PAYMENT_TYPE_OPTIONS } from '../../domain/types/allegro-payment-type.types';
import {
  ALLEGRO_CARRIER_BY_PLATFORM_TYPE,
  ALLEGRO_FULFILLMENT_STATUS_SENT,
  ALLEGRO_OTHER_CARRIER_ID,
} from '../../domain/types/allegro-order-fulfillment.types';
import { AllegroApiException } from '../../domain/exceptions/allegro-api.exception';
import { AllegroOrderDispatchRejectedException } from '../../domain/exceptions/allegro-order-dispatch-rejected.exception';
import { deriveAllegroPaymentStatus } from './allegro-payment-status';

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
export class AllegroOrderSourceAdapter
  implements OrderSourcePort, SourceOptionsReader, OrderDispatchNotifier
{
  private readonly logger = new Logger(AllegroOrderSourceAdapter.name);

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IAllegroHttpClient,
    _connection: Connection
  ) {
    void _connection;
  }

  /**
   * Order-side dispatch (#837): mark the Allegro order sent, and attach the
   * waybill when one is supplied (own-contract branch). For the source-brokered
   * branch (Allegro Delivery) no `trackingNumber` is passed — Allegro already
   * holds the waybill it issued — so only the fulfillment status is set.
   */
  async notifyDispatched(input: {
    externalOrderId: string;
    trackingNumber?: string;
    carrier?: DispatchCarrierHint;
  }): Promise<void> {
    // 1. Mark sent. Treat a 409 (stale optimistic-lock revision / already-sent)
    //    as success for idempotency. `needs-sandbox-probe`: exact 409 semantics.
    try {
      await this.httpClient.put(
        `/order/checkout-forms/${input.externalOrderId}/fulfillment`,
        { status: ALLEGRO_FULFILLMENT_STATUS_SENT },
      );
    } catch (error) {
      if (this.isAlreadySentOrStale(error)) {
        this.logger.debug(
          `Allegro order ${input.externalOrderId} fulfillment already sent / stale revision — treating as success (connection: ${this.connectionId})`,
        );
      } else {
        throw this.toRejected(error, `mark Allegro order ${input.externalOrderId} sent`);
      }
    }

    // 2. Attach the waybill when present (own-contract branch).
    if (input.trackingNumber) {
      const { carrierId, carrierName } = this.resolveCarrier(input.carrier);
      try {
        await this.httpClient.post(
          `/order/checkout-forms/${input.externalOrderId}/shipments`,
          { carrierId, waybill: input.trackingNumber, ...(carrierName ? { carrierName } : {}) },
        );
      } catch (error) {
        throw this.toRejected(error, `attach waybill to Allegro order ${input.externalOrderId}`);
      }
    }
  }

  /** Map the neutral carrier hint → Allegro's fixed carrier vocab (OTHER+name fallback). */
  private resolveCarrier(carrier?: DispatchCarrierHint): { carrierId: string; carrierName?: string } {
    const platformType = carrier?.platformType;
    const known = platformType ? ALLEGRO_CARRIER_BY_PLATFORM_TYPE[platformType] : undefined;
    if (known) {
      return { carrierId: known };
    }
    return { carrierId: ALLEGRO_OTHER_CARRIER_ID, carrierName: platformType ?? 'Carrier' };
  }

  private isAlreadySentOrStale(error: unknown): boolean {
    return (
      error instanceof AllegroApiException &&
      (error.statusCode === 409 || /already/i.test(error.message))
    );
  }

  private toRejected(error: unknown, context: string): Error {
    if (error instanceof AllegroApiException) {
      return new AllegroOrderDispatchRejectedException(`Failed to ${context}: ${error.message}`);
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  /**
   * List incremental order feed items from Allegro's order-events journal.
   *
   * Uses cursor-based pagination; cursor is the Allegro-assigned event ID
   * (opaque to the caller, monotonic per seller).
   */
  async listOrderFeed(input: OrderFeedInput): Promise<OrderFeedOutput> {
    this.logger.debug(
      `Listing Allegro order feed (connection: ${this.connectionId}, fromCursor: ${input.fromCursor || 'none'}, limit: ${input.limit})`
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
        `Allegro /order/events raw response (connection: ${this.connectionId}): ${JSON.stringify(response.data)}`
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
        `Fetched ${events.length} order events (connection: ${this.connectionId}, nextCursor: ${nextCursor || 'none'})`
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
        error
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
      `Fetching Allegro order by checkout form ID: ${checkoutFormId} (connection: ${this.connectionId})`
    );

    try {
      const response = await this.httpClient.get<AllegroCheckoutForm>(
        `/order/checkout-forms/${checkoutFormId}`
      );

      const checkoutForm = response.data;

      const status = checkoutForm.payment.finishedAt ? 'processing' : 'pending';
      // Allegro's checkout-form carries no order-level created timestamp, so
      // `createdAt` is OpenLinker's ingestion time. The buyer-placed time lives
      // on `lineItems[].boughtAt` and is surfaced separately as `placedAt` (#926).
      const createdAt = new Date().toISOString();
      const updatedAt = checkoutForm.updatedAt ?? createdAt;
      const placedAt = this.resolvePlacedAt(checkoutForm.lineItems);

      // #454 — split totals: derive subtotal from line items, shipping from
      // delivery.cost (or fallback). Previously we used `totalToPay` as both
      // subtotal and total, which left PrestaShop with `total_shipping=0` and
      // a `Payment error` reconciliation gap on every Allegro order.
      const subtotal = checkoutForm.lineItems.reduce(
        (acc, item) => acc + Number.parseFloat(item.price.amount) * item.quantity,
        0
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
          // Allegro reports buyer-paid GROSS prices (line `price.amount` and
          // `summary.totalToPay` include tax); it does not decompose tax.
          // Destinations that price net use this to convert before pinning
          // (#895 / ADR-014).
          taxTreatment: 'inclusive',
        },
        shippingAddress: this.resolveShippingAddress(checkoutForm),
        billingAddress: undefined,
        shipping: this.resolveShipping(checkoutForm),
        pickupPoint: this.resolvePickupPoint(checkoutForm),
        deliverySmart: checkoutForm.delivery?.smart,
        paymentStatus: deriveAllegroPaymentStatus(checkoutForm.payment),
        dispatchTime: this.resolveDispatchTime(checkoutForm),
        placedAt,
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
        error
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
    checkoutForm: AllegroCheckoutForm
  ): IncomingOrderAddress | undefined {
    const deliveryAddr = checkoutForm.delivery?.address;
    const hasDeliveryAddress = Boolean(
      deliveryAddr && (deliveryAddr.street || deliveryAddr.city || deliveryAddr.zipCode)
    );

    if (hasDeliveryAddress && deliveryAddr) {
      this.logger.debug(
        `Using delivery.address as shippingAddress for ${checkoutForm.id} (connection: ${this.connectionId})`
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
      pickupAddr && (pickupAddr.street || pickupAddr.city || pickupAddr.zipCode)
    );
    if (hasPickupAddress && pickupAddr) {
      this.logger.debug(
        `Using delivery.pickupPoint.address as shippingAddress for ${checkoutForm.id} (connection: ${this.connectionId})`
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
        `Using buyer.address as shippingAddress fallback for ${checkoutForm.id} (connection: ${this.connectionId})`
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
   * Resolve the buyer-placed timestamp (#926) from the earliest valid
   * `lineItems[].boughtAt` ("ISO date when offer was bought" — the field
   * Allegro itself sorts orders by). The line items of one checkout form are
   * bought together, so the earliest present value is the order-placed time.
   *
   * Unparseable / missing values are skipped so a malformed source value
   * degrades to `undefined` rather than producing an Invalid Date that would
   * throw downstream when the snapshot serializes it.
   */
  private resolvePlacedAt(lineItems: AllegroCheckoutForm['lineItems']): string | undefined {
    let earliestMs: number | undefined;
    let earliestIso: string | undefined;
    for (const item of lineItems) {
      if (typeof item.boughtAt !== 'string') {
        continue;
      }
      const ms = Date.parse(item.boughtAt);
      if (Number.isNaN(ms)) {
        continue;
      }
      if (earliestMs === undefined || ms < earliestMs) {
        earliestMs = ms;
        earliestIso = item.boughtAt;
      }
    }
    return earliestIso;
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

  /**
   * Resolve the marketplace dispatch (ship-by) window (#927).
   *
   * Reads `delivery.time.dispatch.{from,to}` — the shipment window Allegro
   * populates for all delivery methods. `dispatch.to` is the ship-by deadline
   * the SLA surfaces. The deprecated, Kurier-X-press-only `delivery.time.guaranteed`
   * is intentionally NOT consumed. Returns `undefined` when neither bound is
   * present (older orders / sources without a dispatch SLA → graceful no-deadline).
   */
  private resolveDispatchTime(checkoutForm: AllegroCheckoutForm): OrderDispatchWindow | undefined {
    const dispatch = checkoutForm.delivery?.time?.dispatch;
    if (!dispatch?.from && !dispatch?.to) {
      return undefined;
    }
    return { from: dispatch.from, to: dispatch.to };
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
    // Step 1: list the seller's rate-tables AND fetch the canonical method
    // catalogue per relevant marketplace in parallel. The catalogue
    // (`/sale/delivery-methods`) is **per-marketplace-scoped**: querying
    // `?marketplace=allegro-pl` returns only PL-side methods. Polish sellers
    // doing cross-border have cenniki referencing methods from destination
    // marketplaces too (the buyer-side variant of an "International ... do
    // Czech" method lives under `allegro-cz`, etc.). To resolve every id a
    // PL-seller's cenniki can reference, we union the catalogues across PL +
    // CZ + SK + HU. Per-marketplace scoping is non-negotiable: dropping the
    // param entirely returns an empty list on sandbox.
    //
    // The set is hardcoded because OL today only supports PL-anchored
    // sellers; revisit when other Allegro markets come online.
    const sellerMarketplaces = ['allegro-pl', 'allegro-cz', 'allegro-sk', 'allegro-hu'] as const;
    const [rateSets, ...catalogueResponses] = await Promise.all([
      this.httpClient.get<AllegroShippingRatesResponse>('/sale/shipping-rates'),
      ...sellerMarketplaces.map((marketplace) =>
        this.httpClient.get<AllegroDeliveryMethodsResponse>('/sale/delivery-methods', {
          queryParams: { marketplace },
        })
      ),
    ]);
    const rateSetIds = (rateSets.data.shippingRates ?? []).map((r) => r.id);

    // Union catalogues across marketplaces. First-seen wins, but in practice
    // names are stable per id across markets — Allegro uses one global id
    // namespace per method. Per-marketplace sizes logged below for diagnostic.
    const nameById = new Map<string, string>();
    const perMarketplaceSizes = new Map<string, number>();
    for (let i = 0; i < sellerMarketplaces.length; i += 1) {
      const marketplace = sellerMarketplaces[i];
      const methods = catalogueResponses[i].data.deliveryMethods ?? [];
      perMarketplaceSizes.set(marketplace, methods.length);
      for (const method of methods) {
        if (!nameById.has(method.id)) {
          nameById.set(method.id, method.name);
        }
      }
    }

    this.logger.debug(
      `listDeliveryMethods: connection=${this.connectionId} rateSetIds=${rateSetIds.length} ` +
        `catalogue=${nameById.size} (per-marketplace: ${[...perMarketplaceSizes.entries()]
          .map(([m, n]) => `${m}=${n}`)
          .join(', ')})`
    );

    if (rateSetIds.length === 0) {
      this.logger.warn(
        `Allegro returned no shipping-rates for connection ${this.connectionId} — listDeliveryMethods is empty. Operator likely needs to configure cenniki in the seller portal first.`
      );
      return [];
    }

    // Step 2: fetch each rate-table's details in parallel. N+1 in the strict
    // sense but bounded — sellers typically have <20 rate-tables, and this is
    // an operator-driven endpoint (called when opening the carrier-mapping UI),
    // not a hot path. Caching is deferred to a follow-up if latency bites.
    const details = await Promise.all(
      rateSetIds.map((id) =>
        this.httpClient.get<AllegroShippingRateDetailResponse>(`/sale/shipping-rates/${id}`)
      )
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
        `Walked ${rateSetIds.length} rate-tables with ${totalRates} rates for connection ${this.connectionId} but produced 0 delivery methods — possible API shape regression.`
      );
    }

    // Diagnostic: any method id whose label fell through to the id itself
    // means the catalogue lookup missed. A few misses are tolerable (Allegro
    // can have legacy method-ids no longer in the catalogue), but a high
    // ratio means the marketplace scope is wrong, the catalogue is paginated,
    // or the id namespaces have drifted. Helps next-time-this-breaks debug.
    const unresolved = result.filter((r) => r.value === r.label);
    if (unresolved.length > 0) {
      this.logger.warn(
        `listDeliveryMethods: ${unresolved.length}/${result.length} method ids could not be resolved from /sale/delivery-methods catalogue (size=${nameById.size}) for connection ${this.connectionId} — labels falling back to UUIDs.`
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
