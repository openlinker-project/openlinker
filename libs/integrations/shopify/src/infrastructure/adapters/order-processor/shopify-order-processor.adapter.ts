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
import { Logger } from '@openlinker/shared/logging';

import { ShopifyNotSupportedException } from '../../../domain/exceptions/shopify-not-supported.exception';
import { ShopifyUserErrorsException } from '../../../domain/exceptions/shopify-user-errors.exception';
import { fromShopifyGid, toShopifyGid } from '../../../domain/policies/shopify-gid.policy';
import type { ShopifyConnection, ShopifyFulfillmentOrder } from '../../../domain/types/shopify-api.types';
import type { ShopifyGraphqlClient } from '../../http/shopify-graphql-client';
import {
  buildShopifyOrderCreateVariables,
  type ShopifyOrderMappedOptions,
  type ShopifyResolvedLine,
} from '../../mappers/shopify-order-input.mapper';
import { findShopifyExternalId } from '../../readers/shopify-external-id';
import { ShopifyMappingOptionsReader } from '../../readers/shopify-mapping-options.reader';
import {
  FULFILLMENT_ORDER_MOVE_MUTATION,
  ORDER_BY_SOURCE_IDENTIFIER_QUERY,
  ORDER_CREATE_MUTATION,
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

interface OrdersBySourceQuery {
  readonly orders: ShopifyConnection<{ readonly id: string; readonly name: string }>;
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
    DestinationOptionsReader
{
  private readonly logger = new Logger(ShopifyOrderProcessorAdapter.name);
  private readonly options: ShopifyMappingOptionsReader;

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
          `Shopify already holds order ${existing.orderNumber ?? existing.orderId} for ${sourceIdentifier}; ` +
            `not creating a second one (connection: ${this.connection.id})`,
        );
        return existing;
      }
    }

    const lines = await this.resolveLines(order);
    const mapped = await this.resolveMappedOptions(order);
    const payload = await this.client.mutate<CreatedOrderPayload>(
      ORDER_CREATE_MUTATION,
      buildShopifyOrderCreateVariables(order, lines, sourceIdentifier, mapped),
      'orderCreate',
    );
    if (payload.order === null) {
      throw new ShopifyUserErrorsException('orderCreate', [{ message: 'no order returned' }]);
    }
    const ref = toOrderRef(payload.order);
    await this.moveToConfiguredLocation(ref.orderId, payload.order.fulfillmentOrders.nodes, context.locationGid);
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

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async findBySourceIdentifier(sourceIdentifier: string): Promise<OrderRef | null> {
    // Quotes are not part of an OpenLinker id; stripping them keeps the search syntax intact.
    const data = await this.client.query<OrdersBySourceQuery>(ORDER_BY_SOURCE_IDENTIFIER_QUERY, {
      query: `source_identifier:'${sourceIdentifier.replace(/['"\\]/g, '')}'`,
    });
    const found = data.orders.nodes[0];
    return found === undefined ? null : toOrderRef(found);
  }

  /**
   * A line whose variant this connection knows is created against that variant
   * (so the create lowers its stock); any other line becomes a custom line with
   * the item's own title and price, and is warned about, because it moves no
   * stock.
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

  /**
   * The source connection's delivery and payment mappings for this order. A
   * failed lookup is warned about and falls back to the source's own words:
   * the order is still worth creating with the marketplace's method name.
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
    return {
      ...(deliveryMethod === undefined ? {} : { deliveryMethod }),
      ...(paymentGateway === undefined ? {} : { paymentGateway }),
    };
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
