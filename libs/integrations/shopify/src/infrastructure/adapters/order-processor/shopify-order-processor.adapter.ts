/**
 * Shopify Order Processor Adapter
 *
 * Implements `OrderProcessorManagerPort` (`createOrder` via `orderCreate`)
 * plus three sub-capabilities, each narrowed by its guard at the call site:
 *   - `OrderFulfillmentUpdater` and `OrderStatusWriteback`: a dispatch becomes
 *     `fulfillmentCreate` on the order's open fulfillment orders, a
 *     cancellation `orderCancel`. Every other lifecycle event is `unsupported`.
 *   - `DestinationOptionsReader`: the shop's delivery methods (profile method
 *     names plus codes seen on orders), its payment gateways and the neutral
 *     statuses, so a source connection (Allegro) can map onto Shopify. A
 *     mapped delivery method becomes the shipping line title and code, a
 *     mapped payment method the transaction gateway (`resolveMappedOptions`).
 *   - `OrderCreateStockEffect`: `true`, because every create is sent with
 *     `inventoryBehaviour: DECREMENT_OBEYING_POLICY`, so Shopify lowers its own
 *     stock for a variant-backed line at order creation.
 *
 * Dedup: `orderCreate` has NO native idempotency - `@idempotent` is not
 * supported on it and a repeated `sourceIdentifier` creates a second order
 * (L-O3, L-O4). Exactly-once is therefore OpenLinker's: core serialises the
 * create per (order, destination) with `orderCreateLockKey` and writes the
 * mapping, and this adapter adds a best-effort `source_identifier:` lookup
 * before creating. That lookup goes through the search index, which only sees
 * an order ~10 s after it was written (L-O4), so it catches a retry minutes
 * later, never a race - the lock is what covers the race.
 *
 * Single location: OpenLinker runs as one warehouse until a WMS brings
 * multi-location support. Shopify's own routing chooses the fulfillment
 * order's location on create (L-O1 - it chose a non-primary location on the
 * dev store), so after the create every open fulfillment order assigned
 * elsewhere is moved (`fulfillmentOrderMove`) to the configured location. A
 * failed move is warned about and does NOT fail the create: the order exists,
 * and failing would make core retry into a second order. Fulfilment then acts
 * only on fulfillment orders assigned to the configured location.
 *
 * A thrown transport error is rethrown, never turned into `rejected`: a
 * refusal must be the channel's word, not our failure to ask (lessons.md).
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/order-processor
 * @implements {OrderProcessorManagerPort}
 */
import type { IMappingConfigService } from '@openlinker/core/mappings';
import type {
  DestinationOptionsReader,
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
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';

import { ShopifyOrderNotFoundException } from '../../../domain/exceptions/shopify-order-not-found.exception';
import { ShopifyUserErrorsException } from '../../../domain/exceptions/shopify-user-errors.exception';
import { fromShopifyGid, toShopifyGid } from '../../../domain/policies/shopify-gid.policy';
import type { ShopifyConnection, ShopifyFulfillmentOrder } from '../../../domain/types/shopify-api.types';
import type { ShopifyGraphqlClient } from '../../http/shopify-graphql-client';
import {
  buildShopifyOrderCreateVariables,
  type ShopifyOrderMappedOptions,
  type ShopifyResolvedLine,
} from '../../mappers/shopify-order-input.mapper';
import { ShopifyMappingOptionsReader } from '../../readers/shopify-mapping-options.reader';
import { buildShopifyTrackingInfo } from '../../mappers/shopify-tracking.mapper';
import { findShopifyExternalId } from '../../readers/shopify-external-id';
import {
  FULFILLMENT_CREATE_MUTATION,
  FULFILLMENT_ORDER_MOVE_MUTATION,
  ORDER_BY_SOURCE_IDENTIFIER_QUERY,
  ORDER_CANCEL_MUTATION,
  ORDER_CREATE_MUTATION,
  ORDER_FULFILLMENT_ORDERS_QUERY,
} from '../../readers/shopify-order.queries';
import type { ShopifyShopContextProvider } from '../../shop-context/shopify-shop-context.provider';

/** Fulfillment-order states a fulfillment can still be created on. */
const FULFILLABLE_STATUSES: ReadonlySet<string> = new Set(['OPEN', 'IN_PROGRESS']);

interface CreatedOrderPayload {
  readonly order: {
    readonly id: string;
    readonly name: string;
    readonly fulfillmentOrders: ShopifyConnection<ShopifyFulfillmentOrder>;
  } | null;
}

interface FulfillmentOrdersQuery {
  readonly order: {
    readonly id: string;
    readonly displayFulfillmentStatus: string;
    readonly cancelledAt: string | null;
    readonly fulfillmentOrders: ShopifyConnection<ShopifyFulfillmentOrder>;
  } | null;
}

export class ShopifyOrderProcessorAdapter
  implements
    OrderProcessorManagerPort,
    OrderFulfillmentUpdater,
    OrderStatusWriteback,
    OrderCreateStockEffect,
    DestinationOptionsReader
{
  private readonly logger = new Logger(ShopifyOrderProcessorAdapter.name);
  private readonly options: ShopifyMappingOptionsReader;

  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly shopContext: ShopifyShopContextProvider,
    private readonly connection: Connection,
    private readonly mappingConfig?: () => IMappingConfigService | undefined,
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
    const metadataId = order.metadata?.internalOrderId;
    const sourceIdentifier =
      order.internalOrderId ?? (typeof metadataId === 'string' ? metadataId : undefined);

    if (sourceIdentifier !== undefined) {
      const existing = await this.findBySourceIdentifier(sourceIdentifier);
      if (existing !== null) {
        this.logger.warn(
          `Shopify already holds order ${existing.orderNumber ?? existing.orderId} for ${sourceIdentifier}; ` +
            `not creating a second one (connection: ${this.connection.id})`,
        );
        return existing;
      }
    }

    const lines = await this.resolveLines(order);
    const mapped = await this.resolveMappedOptions(order);
    const variables = buildShopifyOrderCreateVariables(order, lines, sourceIdentifier, mapped);
    const payload = await this.client.mutate<CreatedOrderPayload>(
      ORDER_CREATE_MUTATION,
      variables,
      'orderCreate',
    );
    if (payload.order === null) {
      throw new ShopifyUserErrorsException('orderCreate', [{ message: 'no order returned' }]);
    }
    const ref: OrderRef = {
      orderId: fromShopifyGid(payload.order.id),
      orderNumber: payload.order.name.replace(/^#/, ''),
    };
    await this.moveToConfiguredLocation(ref.orderId, payload.order.fulfillmentOrders.nodes);
    return ref;
  }

  // ─── OrderCreateStockEffect ────────────────────────────────────────────────

  lowersStockOnOrderCreate(): Promise<boolean> {
    return Promise.resolve(true);
  }

  // ─── OrderFulfillmentUpdater ───────────────────────────────────────────────

  async updateFulfillment(input: {
    externalOrderId: string;
    status: OrderStatus;
    trackingNumber?: string;
  }): Promise<void> {
    if (input.status === 'shipped' || input.status === 'delivered') {
      const result = await this.fulfil(input.externalOrderId, input.trackingNumber, undefined);
      if (result.outcome === 'rejected') {
        throw new ShopifyUserErrorsException('fulfillmentCreate', [{ message: result.detail ?? 'refused' }]);
      }
      return;
    }
    if (input.status === 'cancelled') {
      await this.cancel(input.externalOrderId);
      return;
    }
    this.logger.debug(
      `Shopify has no counterpart for status "${input.status}"; order ${input.externalOrderId} left as is`,
    );
  }

  // ─── OrderStatusWriteback ──────────────────────────────────────────────────

  async write(event: OrderLifecycleEvent): Promise<OrderWritebackResult> {
    switch (event.type) {
      case 'dispatched':
        return this.fulfil(event.externalOrderId, event.trackingNumber, event.carrier?.platformType);
      case 'cancelled':
        return this.cancel(event.externalOrderId);
      default:
        return { outcome: 'unsupported', detail: `Shopify writeback does not handle "${event.type}"` };
    }
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /**
   * The source connection's carrier and payment mappings for this order. A
   * failed lookup is warned about and falls back to the source's own words:
   * the order is still worth creating with the marketplace's method name.
   */
  private async resolveMappedOptions(order: OrderCreate): Promise<ShopifyOrderMappedOptions> {
    const service = this.mappingConfig?.();
    const sourceConnectionId = order.source?.connectionId;
    if (service === undefined || !sourceConnectionId) {
      return {};
    }
    const methodId = order.shipping?.methodId;
    const sourcePayment = order.sourcePaymentMethod;
    const lookup = async (what: string, run: () => Promise<string | null>): Promise<string | undefined> => {
      try {
        const value = (await run())?.trim();
        return value ? value : undefined;
      } catch (error) {
        this.logger.warn(
          `Shopify ${what} mapping lookup failed (source ${sourceConnectionId}, destination ${this.connection.id}); ` +
            `using the source's own value: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      }
    };
    const deliveryMethod = methodId
      ? await lookup('carrier', () => service.resolveCarrierMapping(sourceConnectionId, methodId))
      : undefined;
    const paymentGateway = sourcePayment
      ? await lookup('payment', () => service.resolvePaymentMapping(sourceConnectionId, sourcePayment))
      : undefined;
    return {
      ...(deliveryMethod === undefined ? {} : { deliveryMethod }),
      ...(paymentGateway === undefined ? {} : { paymentGateway }),
    };
  }

  private async findBySourceIdentifier(sourceIdentifier: string): Promise<OrderRef | null> {
    const data = await this.client.query<{ orders: ShopifyConnection<{ id: string; name: string }> }>(
      ORDER_BY_SOURCE_IDENTIFIER_QUERY,
      { query: `source_identifier:'${sourceIdentifier.replace(/'/g, '')}'` },
    );
    const found = data.orders.nodes[0];
    return found === undefined
      ? null
      : { orderId: fromShopifyGid(found.id), orderNumber: found.name.replace(/^#/, '') };
  }

  /**
   * A line whose variant this connection knows is created against that variant
   * (so the create lowers its stock); any other line becomes a custom line with
   * the item's own title and price, and is warned about, because it decrements
   * nothing.
   */
  private async resolveLines(order: OrderCreate): Promise<ShopifyResolvedLine[]> {
    const lines: ShopifyResolvedLine[] = [];
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
      lines.push({
        item,
        variantGid: variantExternalId === null ? null : toShopifyGid('ProductVariant', variantExternalId),
      });
    }
    return lines;
  }

  private async moveToConfiguredLocation(
    orderId: string,
    fulfillmentOrders: readonly ShopifyFulfillmentOrder[],
  ): Promise<void> {
    let locationGid: string;
    try {
      ({ locationGid } = await this.shopContext.get());
    } catch (error) {
      this.logger.warn(
        `Shopify order ${orderId}: configured location unknown, fulfillment orders not moved: ` +
          `${error instanceof Error ? error.message : String(error)} (connection: ${this.connection.id})`,
      );
      return;
    }
    for (const fo of fulfillmentOrders) {
      const assigned = fo.assignedLocation?.location?.id;
      if (assigned === locationGid || !FULFILLABLE_STATUSES.has(fo.status)) {
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
        this.logger.warn(
          `Shopify order ${orderId}: could not move fulfillment order ${fromShopifyGid(fo.id)} to ` +
            `${locationGid}; it stays at ${assigned ?? 'no location'}: ` +
            `${error instanceof Error ? error.message : String(error)} (connection: ${this.connection.id})`,
        );
      }
    }
  }

  private async readFulfillmentOrders(externalOrderId: string): Promise<NonNullable<FulfillmentOrdersQuery['order']>> {
    const data = await this.client.query<FulfillmentOrdersQuery>(ORDER_FULFILLMENT_ORDERS_QUERY, {
      id: toShopifyGid('Order', externalOrderId),
    });
    if (data.order === null) {
      throw new ShopifyOrderNotFoundException(externalOrderId, this.connection.id);
    }
    return data.order;
  }

  /**
   * Fulfils everything still open on the fulfillment orders assigned to the
   * configured location, with tracking when a number is known. An order
   * already fulfilled reports `applied` (the same event delivered twice).
   */
  private async fulfil(
    externalOrderId: string,
    trackingNumber: string | undefined,
    carrierPlatformType: string | undefined,
  ): Promise<OrderWritebackResult> {
    const order = await this.readFulfillmentOrders(externalOrderId);
    const { locationGid } = await this.shopContext.get();
    const open = order.fulfillmentOrders.nodes.filter(
      (fo) =>
        FULFILLABLE_STATUSES.has(fo.status) &&
        fo.assignedLocation?.location?.id === locationGid &&
        (fo.lineItems?.nodes ?? []).some((l) => l.remainingQuantity > 0),
    );
    if (open.length === 0) {
      if (order.displayFulfillmentStatus === 'FULFILLED') {
        return { outcome: 'applied', detail: 'already fulfilled on Shopify' };
      }
      return {
        outcome: 'rejected',
        detail: `no open fulfillment order at the configured location ${locationGid}`,
      };
    }

    const tracking =
      trackingNumber === undefined || trackingNumber.trim().length === 0
        ? null
        : buildShopifyTrackingInfo(trackingNumber, carrierPlatformType);
    try {
      await this.client.mutate(
        FULFILLMENT_CREATE_MUTATION,
        {
          fulfillment: {
            lineItemsByFulfillmentOrder: open.map((fo) => ({ fulfillmentOrderId: fo.id })),
            ...(tracking === null ? {} : { trackingInfo: tracking }),
            notifyCustomer: false,
          },
        },
        'fulfillmentCreate',
      );
    } catch (error) {
      if (error instanceof ShopifyUserErrorsException && !error.isRateLimited()) {
        return { outcome: 'rejected', detail: error.message };
      }
      throw error;
    }
    return { outcome: 'applied' };
  }

  /** `orderCancel` keeps any payment (`refund: false`) and restocks; an already cancelled order is `applied`. */
  private async cancel(externalOrderId: string): Promise<OrderWritebackResult> {
    const order = await this.readFulfillmentOrders(externalOrderId);
    if (order.cancelledAt !== null) {
      return { outcome: 'applied', detail: 'already cancelled on Shopify' };
    }
    try {
      await this.client.mutate(
        ORDER_CANCEL_MUTATION,
        { id: toShopifyGid('Order', externalOrderId) },
        'orderCancel',
        'orderCancelUserErrors',
      );
    } catch (error) {
      if (error instanceof ShopifyUserErrorsException && !error.isRateLimited()) {
        return { outcome: 'rejected', detail: error.message };
      }
      throw error;
    }
    // The cancel runs as an async job on Shopify; it is accepted, not yet visible.
    return { outcome: 'applied' };
  }
}
