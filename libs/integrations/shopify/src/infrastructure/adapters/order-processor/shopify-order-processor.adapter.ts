/**
 * Shopify Order Processor Adapter
 *
 * Shopify as an order DESTINATION (#3978): an order from a marketplace
 * (Allegro, Erli) is created in the store with `orderCreate`. Implements
 * `OrderProcessorManagerPort` plus four sub-capabilities, each narrowed by its
 * guard at the call site:
 *   - `OrderStatusWriteback` and `OrderFulfillmentUpdater`: a dispatch is
 *     `fulfillmentCreate` with tracking, a cancellation `orderCancel`, through
 *     the same `ShopifyOrderStatusWriteback` the order source uses.
 *   - `DestinationOptionsReader`: the store's delivery methods and payment
 *     gateways, so a source connection's methods can be mapped onto them.
 *     A mapped delivery method becomes the shipping line title and code, a
 *     mapped payment method the transaction gateway.
 *   - `OrderCreateStockEffect`: `true`, because every create is sent with
 *     `inventoryBehaviour: DECREMENT_OBEYING_POLICY`, so Shopify lowers its own
 *     stock for a variant line when the order is created.
 *
 * Exactly once: `orderCreate` has no `@idempotent` support, and a repeated
 * `sourceIdentifier` creates a second order. Core serialises the create per
 * (order, destination) under its order-create lock and writes the mapping;
 * this adapter adds a `source_identifier:` lookup before creating, which finds
 * an order created by an attempt whose answer was lost. The lookup goes
 * through the search index, which sees an order seconds after it was
 * written, so it covers a retry, never a race (the lock covers the race).
 *
 * Currency: an order in a currency other than the store's is refused before
 * anything is sent. The integration does not use presentment currencies, so
 * Shopify would book the buyer's amounts as store-currency amounts.
 *
 * Single location: Shopify's routing chooses the fulfillment order's location
 * on create, often not the configured one, so each open fulfillment order
 * assigned elsewhere is moved (`fulfillmentOrderMove`) to it right after the
 * create. A failed move is warned about and does NOT fail the create: the
 * order exists, and failing would make core retry into a second order. The
 * dispatch writeback moves leftover work again before it fulfils.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/order-processor
 * @implements {OrderProcessorManagerPort}
 */
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import type {
  DestinationOptionsReader,
  FulfillmentStatusReader,
  FulfillmentStatusSnapshot,
  MappingOption,
  OrderCreate,
  OrderCreateStockEffect,
  OrderFulfillmentUpdater,
  OrderLifecycleEvent,
  OrderProcessorManagerPort,
  OrderRef,
  OrderStatus,
  OrderStatusWriteback,
  OrderWritebackResult,
} from '@openlinker/core/orders';
import { FULFILLMENT_STATUS } from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

import { ShopifyOrderNotFoundException } from '../../../domain/exceptions/shopify-order-not-found.exception';
import { ShopifyNotSupportedException } from '../../../domain/exceptions/shopify-not-supported.exception';
import { ShopifyUserErrorsException } from '../../../domain/exceptions/shopify-user-errors.exception';
import { fromShopifyGid, toShopifyGid } from '../../../domain/policies/shopify-gid.policy';
import type { ShopifyConnection, ShopifyFulfillmentOrder } from '../../../domain/types/shopify-api.types';
import type { ShopifyGraphqlClient } from '../../http/shopify-graphql-client';
import {
  buildShopifyOrderCreateVariables,
  shopifyOrderDiscount,
  type ShopifyOrderMappedOptions,
  type ShopifyResolvedLine,
} from '../../mappers/shopify-order-input.mapper';
import { findShopifyExternalId } from '../../readers/shopify-external-id';
import { ShopifyMappingOptionsReader } from '../../readers/shopify-mapping-options.reader';
import {
  FULFILLMENT_ORDER_MOVE_MUTATION,
  ORDER_BY_SOURCE_IDENTIFIER_QUERY,
  ORDER_FULFILLMENT_STATUS_QUERY,
  ORDER_CREATE_MUTATION,
  VARIANTS_REQUIRE_SHIPPING_QUERY,
} from '../../readers/shopify-order.queries';
import type { ShopifyShopContextProvider } from '../../shop-context/shopify-shop-context.provider';
import type { ShopifyOrderStatusWriteback } from '../order-status/shopify-order-status-writeback';

/** Fulfillment-order states that still hold work to move. */
const MOVABLE_STATUSES: ReadonlySet<string> = new Set(['OPEN', 'IN_PROGRESS']);

interface CreatedOrderPayload {
  readonly order: {
    readonly id: string;
    readonly name: string;
    readonly fulfillmentOrders: ShopifyConnection<ShopifyFulfillmentOrder>;
  } | null;
}

interface VariantsRequireShippingQuery {
  readonly nodes: ReadonlyArray<{
    readonly id?: string;
    readonly inventoryItem?: { readonly requiresShipping: boolean } | null;
  } | null>;
}

interface OrderFulfillmentStatusQuery {
  readonly order: {
    readonly cancelledAt: string | null;
    readonly displayFulfillmentStatus: string;
    readonly fulfillments: ReadonlyArray<{
      readonly status: string;
      readonly displayStatus: string | null;
      readonly deliveredAt: string | null;
      readonly trackingInfo: ReadonlyArray<{ readonly number: string | null }>;
    }>;
  } | null;
}

interface OrdersBySourceQuery {
  readonly orders: ShopifyConnection<{
    readonly id: string;
    readonly name: string;
    readonly fulfillmentOrders: { readonly nodes: readonly ShopifyFulfillmentOrder[] };
  }>;
}

interface ExistingOrder {
  readonly ref: OrderRef;
  readonly fulfillmentOrders: readonly ShopifyFulfillmentOrder[];
}

/**
 * Shopify's order search is eventually consistent: an order created a moment
 * ago (the previous attempt timed out after Shopify applied it) can be missing
 * from `orders(query:)` for a short while. A miss is therefore re-asked a
 * couple of times before the order is treated as new, because creating a
 * second order decrements stock twice.
 */
const LOOKUP_RETRY_DELAYS_MS: readonly number[] = [500, 1500];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toOrderRef(node: { id: string; name: string }): OrderRef {
  return { orderId: fromShopifyGid(node.id), orderNumber: node.name.replace(/^#/, '') };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ShopifyOrderProcessorAdapter
  implements
    OrderProcessorManagerPort,
    OrderFulfillmentUpdater,
    OrderStatusWriteback,
    OrderCreateStockEffect,
    DestinationOptionsReader,
    FulfillmentStatusReader
{
  private readonly logger = new Logger(ShopifyOrderProcessorAdapter.name);
  private readonly options: ShopifyMappingOptionsReader;

  /** Delays between re-asks of the source-identifier search after a miss; tests shorten it. */
  private readonly lookupRetryDelaysMs: readonly number[] = LOOKUP_RETRY_DELAYS_MS;

  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly shopContext: ShopifyShopContextProvider,
    private readonly connection: Connection,
    private readonly writeback: ShopifyOrderStatusWriteback,
    private readonly mappingConfig?: IMappingConfigService,
  ) {
    this.options = new ShopifyMappingOptionsReader(client, connection.id);
  }

  // ─── DestinationOptionsReader ──────────────────────────────────────────────

  listCarriers(): Promise<MappingOption[]> {
    return this.options.listDeliveryMethods();
  }

  listOrderStatuses(): Promise<MappingOption[]> {
    return this.options.listOrderStatuses();
  }

  listPaymentMethods(): Promise<MappingOption[]> {
    return this.options.listPaymentMethods();
  }

  // ─── OrderProcessorManagerPort ─────────────────────────────────────────────

  async createOrder(order: OrderCreate): Promise<OrderRef> {
    const context = await this.shopContext.get();
    if (order.totals.currency.toUpperCase() !== context.currencyCode.toUpperCase()) {
      throw new ShopifyNotSupportedException(
        `creating an order in ${order.totals.currency} in a store that sells in ${context.currencyCode}`,
      );
    }

    const metadataId = order.metadata?.internalOrderId;
    const sourceIdentifier =
      order.internalOrderId ?? (typeof metadataId === 'string' && metadataId.length > 0 ? metadataId : undefined);
    if (sourceIdentifier !== undefined) {
      const existing = await this.findBySourceIdentifier(sourceIdentifier);
      if (existing !== null) {
        this.logger.warn(
          `Shopify already holds order ${existing.ref.orderNumber ?? existing.ref.orderId} for ${sourceIdentifier}; ` +
            `not creating a second one (connection: ${this.connection.id})`,
        );
        // The previous attempt may have died between the create and the move.
        await this.moveSafely(existing.ref.orderId, existing.fulfillmentOrders, context.locationGid);
        return existing.ref;
      }
    }

    const lines = await this.resolveLines(order);
    const mapped = await this.resolveMappedOptions(order);
    const discount = order.totals.discountTotal;
    if (discount !== undefined && discount > 0 && shopifyOrderDiscount(order, lines) === null) {
      this.logger.warn(
        `Order ${order.orderNumber ?? sourceIdentifier ?? 'unknown'} reports a whole-order discount of ${discount} ` +
          `that cannot be split across its lines; the Shopify order is created at the listed prices, MORE than ` +
          `the buyer paid (connection: ${this.connection.id})`,
      );
    }
    const payload = await this.client.mutate<CreatedOrderPayload>(
      ORDER_CREATE_MUTATION,
      buildShopifyOrderCreateVariables(order, lines, sourceIdentifier, mapped),
      'orderCreate',
    );
    if (payload.order === null) {
      throw new ShopifyUserErrorsException('orderCreate', [{ message: 'no order returned' }]);
    }
    const ref = toOrderRef(payload.order);
    await this.moveSafely(ref.orderId, payload.order.fulfillmentOrders.nodes, context.locationGid);
    return ref;
  }

  // ─── OrderCreateStockEffect ────────────────────────────────────────────────

  lowersStockOnOrderCreate(): Promise<boolean> {
    return Promise.resolve(true);
  }

  // ─── OrderStatusWriteback ──────────────────────────────────────────────────

  write(event: OrderLifecycleEvent): Promise<OrderWritebackResult> {
    return this.writeback.write(event);
  }

  // ─── OrderFulfillmentUpdater ───────────────────────────────────────────────

  /**
   * The older status push: `shipped` and `delivered` fulfil, `cancelled`
   * cancels, and every other status has no Shopify counterpart. A refusal
   * Shopify states throws here, because this port has no result to carry it.
   */
  async updateFulfillment(input: {
    externalOrderId: string;
    status: OrderStatus;
    trackingNumber?: string;
  }): Promise<void> {
    let event: OrderLifecycleEvent;
    if (input.status === 'shipped' || input.status === 'delivered') {
      event = {
        type: 'dispatched',
        externalOrderId: input.externalOrderId,
        ...(input.trackingNumber === undefined ? {} : { trackingNumber: input.trackingNumber }),
      };
    } else if (input.status === 'cancelled') {
      event = { type: 'cancelled', externalOrderId: input.externalOrderId };
    } else {
      this.logger.debug(
        `Shopify has no counterpart for status "${input.status}"; order ${input.externalOrderId} left as is`,
      );
      return;
    }
    const result = await this.writeback.write(event);
    if (result.outcome === 'rejected') {
      throw new ShopifyUserErrorsException('updateFulfillment', [{ message: result.detail ?? 'refused' }]);
    }
  }

  // ─── FulfillmentStatusReader ───────────────────────────────────────────────

  /**
   * The copy's own view of its fulfillment, so a parcel packed in the Shopify
   * admin reaches OpenLinker. Cancelled wins; otherwise the order must be
   * FULFILLED (a partial fulfillment is not yet a dispatch the marketplace
   * should be told about) and is `delivered` once every live fulfillment says
   * so. Anything else is `null`: Shopify has not acted on it yet.
   */
  async getFulfillmentStatus(input: { externalOrderId: string }): Promise<FulfillmentStatusSnapshot> {
    const data = await this.client.query<OrderFulfillmentStatusQuery>(ORDER_FULFILLMENT_STATUS_QUERY, {
      id: toShopifyGid('Order', input.externalOrderId),
    });
    const order = data.order;
    if (order === null) {
      throw new ShopifyOrderNotFoundException(input.externalOrderId, this.connection.id);
    }
    if (order.cancelledAt !== null) {
      return { status: FULFILLMENT_STATUS.Cancelled, trackingNumber: null, deliveredAt: null };
    }
    const live = order.fulfillments.filter((f) => f.status === 'SUCCESS');
    if (order.displayFulfillmentStatus !== 'FULFILLED' || live.length === 0) {
      return { status: null, trackingNumber: null, deliveredAt: null };
    }
    const trackingNumber = live.flatMap((f) => f.trackingInfo).find((t) => t.number)?.number ?? null;
    if (live.every((f) => f.displayStatus === 'DELIVERED')) {
      const instants = live.flatMap((f) => (f.deliveredAt === null ? [] : [Date.parse(f.deliveredAt)]));
      const latest = instants.length === 0 ? null : new Date(Math.max(...instants));
      return { status: FULFILLMENT_STATUS.Delivered, trackingNumber, deliveredAt: latest };
    }
    return { status: FULFILLMENT_STATUS.Dispatched, trackingNumber, deliveredAt: null };
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async findBySourceIdentifier(sourceIdentifier: string): Promise<ExistingOrder | null> {
    // Quotes are not part of an OpenLinker id; stripping them keeps the search syntax intact.
    const variables = { query: `source_identifier:'${sourceIdentifier.replace(/['"\\]/g, '')}'` };
    for (let attempt = 0; ; attempt += 1) {
      const data = await this.client.query<OrdersBySourceQuery>(ORDER_BY_SOURCE_IDENTIFIER_QUERY, variables);
      const found = data.orders.nodes[0];
      if (found !== undefined) {
        return { ref: toOrderRef(found), fulfillmentOrders: found.fulfillmentOrders?.nodes ?? [] };
      }
      const delay = this.lookupRetryDelaysMs[attempt];
      if (delay === undefined) {
        return null;
      }
      await sleep(delay);
    }
  }

  /** The order exists from here on, so nothing in the location move may fail the create. */
  private async moveSafely(
    orderId: string,
    fulfillmentOrders: readonly ShopifyFulfillmentOrder[],
    locationGid: string,
  ): Promise<void> {
    try {
      await this.moveToConfiguredLocation(orderId, fulfillmentOrders, locationGid);
    } catch (error) {
      this.logger.warn(
        `Shopify order ${orderId}: the location move failed after the order was created: ${errorMessage(error)} ` +
          `(connection: ${this.connection.id})`,
      );
    }
  }

  /**
   * A line whose variant this connection knows is created against that variant
   * (so the create lowers its stock); any other line becomes a custom line with
   * the item's own title and price, and is warned about, because it moves no
   * stock. Whether each variant ships is read in one query (D1); a variant the
   * read does not answer for ships, since a parcel nobody can label is the
   * worse mistake.
   */
  private async resolveLines(order: OrderCreate): Promise<ShopifyResolvedLine[]> {
    const resolved: Array<{ item: OrderCreate['items'][number]; variantGid: string | null }> = [];
    for (const item of order.items) {
      const variantExternalId =
        item.variantId === undefined
          ? null
          : await findShopifyExternalId(
              this.identifierMapping,
              this.connection.id,
              CORE_ENTITY_TYPE.ProductVariant,
              item.variantId,
            );
      if (variantExternalId === null) {
        this.logger.warn(
          `Order line ${item.id} (${item.sku ?? item.productId}) has no Shopify variant on this connection; ` +
            `created as a custom line that moves no stock (connection: ${this.connection.id})`,
        );
      }
      resolved.push({
        item,
        variantGid: variantExternalId === null ? null : toShopifyGid('ProductVariant', variantExternalId),
      });
    }
    const shipping = await this.readRequiresShipping(
      resolved.map((line) => line.variantGid).filter((gid): gid is string => gid !== null),
    );
    return resolved.map((line) => ({
      ...line,
      requiresShipping: line.variantGid === null ? true : (shipping.get(line.variantGid) ?? true),
    }));
  }

  private async readRequiresShipping(variantGids: readonly string[]): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    if (variantGids.length === 0) {
      return result;
    }
    const data = await this.client.query<VariantsRequireShippingQuery>(VARIANTS_REQUIRE_SHIPPING_QUERY, {
      ids: [...new Set(variantGids)],
    });
    for (const node of data.nodes) {
      if (node?.id !== undefined && node.inventoryItem) {
        result.set(node.id, node.inventoryItem.requiresShipping);
      }
    }
    return result;
  }

  /**
   * The source connection's delivery and payment mappings for this order. A
   * failed lookup is warned about and falls back to the source's own words:
   * the order is still worth creating with the marketplace's method name.
   *
   * The mappings are stored per SOURCE, not per destination, so a value mapped
   * for another shop (a PrestaShop carrier id such as `1`) reaches this one too
   * (D5). A mapped value is used only when it is one of this store's own
   * delivery methods or payment gateways; anything else is warned about and the
   * source's own words are used.
   */
  private async resolveMappedOptions(order: OrderCreate): Promise<ShopifyOrderMappedOptions> {
    const service = this.mappingConfig;
    const sourceConnectionId = order.source?.connectionId;
    if (service === undefined || !sourceConnectionId) {
      return {};
    }
    const lookup = async (what: string, run: () => Promise<string | null>): Promise<string | undefined> => {
      try {
        const value = (await run())?.trim();
        return value ? value : undefined;
      } catch (error) {
        this.logger.warn(
          `Shopify ${what} mapping lookup failed (source ${sourceConnectionId}, destination ${this.connection.id}); ` +
            `using the source's own value: ${errorMessage(error)}`,
        );
        return undefined;
      }
    };
    const methodId = order.shipping?.methodId;
    const sourcePayment = order.sourcePaymentMethod;
    const deliveryMethod = methodId
      ? await lookup('delivery', () => service.resolveCarrierMapping(sourceConnectionId, methodId))
      : undefined;
    const paymentGateway = sourcePayment
      ? await lookup('payment', () => service.resolvePaymentMapping(sourceConnectionId, sourcePayment))
      : undefined;
    const knownDelivery = deliveryMethod === undefined ? undefined : await this.ownValue('delivery', deliveryMethod);
    const knownPayment = paymentGateway === undefined ? undefined : await this.ownValue('payment', paymentGateway);
    return {
      ...(knownDelivery === undefined ? {} : { deliveryMethod: knownDelivery }),
      ...(knownPayment === undefined ? {} : { paymentGateway: knownPayment }),
    };
  }

  /** The mapped value when this store offers it, otherwise undefined (warned). */
  private async ownValue(kind: 'delivery' | 'payment', value: string): Promise<string | undefined> {
    let offered: MappingOption[];
    try {
      offered =
        kind === 'delivery' ? await this.options.listDeliveryMethods() : await this.options.listPaymentMethods();
    } catch (error) {
      this.logger.warn(
        `Shopify ${kind} options could not be read, so the mapped value "${value}" is not used ` +
          `(connection: ${this.connection.id}): ${errorMessage(error)}`,
      );
      return undefined;
    }
    if (offered.some((option) => option.value === value)) {
      return value;
    }
    this.logger.warn(
      `Mapped ${kind} value "${value}" is not one of this Shopify store's own; it is ignored and the source's ` +
        `own value is used (mappings are per source, so it may belong to another destination) ` +
        `(connection: ${this.connection.id})`,
    );
    return undefined;
  }

  private async moveToConfiguredLocation(
    orderId: string,
    fulfillmentOrders: readonly ShopifyFulfillmentOrder[],
    locationGid: string,
  ): Promise<void> {
    for (const fo of fulfillmentOrders) {
      const assigned = fo.assignedLocation?.location?.id;
      if (assigned === locationGid || !MOVABLE_STATUSES.has(fo.status)) {
        continue;
      }
      try {
        await this.client.mutate(
          FULFILLMENT_ORDER_MOVE_MUTATION,
          { id: fo.id, locationId: locationGid },
          'fulfillmentOrderMove',
        );
        this.logger.log(
          `Shopify order ${orderId}: fulfillment order ${fromShopifyGid(fo.id)} moved from ` +
            `${assigned ?? 'no location'} to ${locationGid} (connection: ${this.connection.id})`,
        );
      } catch (error) {
        // Never rethrown: the order exists, and a throw here would make core
        // retry the create. The dispatch writeback moves leftover work again.
        this.logger.warn(
          `Shopify order ${orderId}: could not move fulfillment order ${fromShopifyGid(fo.id)} to ` +
            `${locationGid}; it stays at ${assigned ?? 'no location'}: ${errorMessage(error)} ` +
            `(connection: ${this.connection.id})`,
        );
      }
    }
  }
}
