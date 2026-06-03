/**
 * WooCommerce Order Processor Adapter
 *
 * Implements OrderProcessorManagerPort (createOrder) and the OrderFulfillmentUpdater
 * sub-capability (updateFulfillment — status updates, cancellations, refund transitions)
 * for WooCommerce REST API v3.
 *
 * Key design decisions:
 * - createOrder: idempotent via identifier mapping + _ol_order_id meta_data on the WC order
 * - Customer provisioning: POST /customers with email from order metadata; degrades to guest on failure
 * - destination_address_mappings: not applicable — WC has no address entities; addresses are
 *   embedded inline in the order payload
 * - DuplicateIdentifierMappingError: handled for both Order and Customer createMapping calls
 *   to prevent duplicate WC resources on concurrent retries
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/order-processor
 * @implements {OrderProcessorManagerPort}
 * @implements {OrderFulfillmentUpdater}
 */
import type {
  OrderProcessorManagerPort,
  OrderCreate,
  OrderRef,
  OrderItem,
  Address,
  OrderStatus,
} from '@openlinker/core/orders';
import type { OrderFulfillmentUpdater } from '@openlinker/core/orders';
import type { IdentifierMappingPort, Connection, ExternalIdMapping } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE, DuplicateIdentifierMappingError } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import type { IWooCommerceHttpClient } from '../../http/woocommerce-http-client.interface';
import { WooCommerceHttpResponseException } from '../../http/woocommerce-http-response.exception';
import { WooCommerceResourceNotFoundException } from '../../../domain/exceptions/woocommerce-resource-not-found.exception';
import { WooCommerceOrderProcessingException } from '../../../domain/exceptions/woocommerce-order-processing.exception';
import type {
  WooCommerceOrderCreateRequest,
  WooCommerceOrderUpdateRequest,
  WooCommerceOrderResponse,
  WooCommerceOrderAddress,
  WooCommerceLineItemRequest,
  WooCommerceShippingLineRequest,
  WooCommerceCustomerCreateRequest,
  WooCommerceCustomerResponse,
} from './woocommerce-order.types';
import { WC_ORDER_STATUS_MAP } from './woocommerce-order.types';

// ─── Module-level pure helpers ────────────────────────────────────────────────
// Pure functions with no dependency on adapter state — independently testable.

/**
 * RFC-5322-lite email format guard.
 * Uses typeof before the regex to satisfy strict null checks without a cast.
 */
export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Converts a string identifier-mapping externalId to a positive WC integer ID.
 * Throws WooCommerceResourceNotFoundException rather than silently producing NaN —
 * JSON.stringify({ id: NaN }) → { "id": null } would corrupt the WC resource.
 */
export function toPositiveInt(
  value: string,
  entityType: string,
  entityId: string,
  connectionId: string,
): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new WooCommerceResourceNotFoundException(
      `Corrupted mapping: "${value}" is not a valid positive integer WC ID for ${entityType} ${entityId}`,
      entityType,
      entityId,
      connectionId,
    );
  }
  return n;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class WooCommerceOrderProcessorAdapter
  implements OrderProcessorManagerPort, OrderFulfillmentUpdater
{
  private readonly logger = new Logger(WooCommerceOrderProcessorAdapter.name);

  constructor(
    private readonly httpClient: IWooCommerceHttpClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly connection: Connection,
  ) {}

  // ─── OrderProcessorManagerPort ────────────────────────────────────────────

  async createOrder(order: OrderCreate): Promise<OrderRef> {
    this.logger.debug(
      `createOrder: status=${order.status} items=${order.items.length} (connection: ${this.connection.id})`,
    );

    // Step 1 — assert internalOrderId (always set by OrderIngestionService)
    const internalOrderId = order.metadata?.internalOrderId;
    if (typeof internalOrderId !== 'string' || internalOrderId.length === 0) {
      throw new WooCommerceOrderProcessingException(
        'createOrder called without metadata.internalOrderId — upstream programming error',
        this.connection.id,
      );
    }

    // Step 2 — idempotency: if we already created a WC order for this OL order, return early
    const existingIds = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Order,
      internalOrderId,
    );
    const existing = existingIds.find((e: ExternalIdMapping) => e.connectionId === this.connection.id);
    if (existing) {
      this.logger.debug(
        `createOrder: idempotent return for order ${internalOrderId} (WC ${existing.externalId})`,
      );
      return { orderId: internalOrderId };
    }

    // Step 3 — extract and validate buyer email from order metadata
    const rawEmail = order.metadata?.buyerEmail;
    const buyerEmail = isValidEmail(rawEmail) ? rawEmail : undefined;
    if (!buyerEmail) {
      this.logger.debug(
        `createOrder: billing.email absent or invalid for order ${internalOrderId} — WC order confirmation will not be sent`,
      );
    }

    // Step 4 — resolve or provision WC customer
    const customerId = await this.resolveCustomerId(order, buyerEmail);

    // Step 5 — resolve line items (throws on any unresolvable or corrupted mapping)
    const lineItems = await this.resolveLineItems(order.items);

    // Step 6 — build shipping lines
    const shippingLines = this.buildShippingLines(order);

    // Step 7 — build WC order payload
    const payload: WooCommerceOrderCreateRequest = {
      status: WC_ORDER_STATUS_MAP[order.status],
      customer_id: customerId,
      billing: {
        ...this.mapAddress(order.billingAddress),
        ...(buyerEmail ? { email: buyerEmail } : {}),
      },
      shipping: this.mapAddress(order.shippingAddress),
      line_items: lineItems,
      ...(shippingLines.length > 0 ? { shipping_lines: shippingLines } : {}),
      payment_method: 'other',
      payment_method_title: 'External',
      set_paid: true,
      meta_data: [{ key: '_ol_order_id', value: internalOrderId }],
    };

    // Step 8 — create WC order
    const raw = await this.httpClient.post<WooCommerceOrderResponse>(
      '/wp-json/wc/v3/orders',
      payload,
    );

    // Step 9 — register identifier mapping with concurrent-duplicate handler
    try {
      await this.identifierMapping.createMapping(
        CORE_ENTITY_TYPE.Order,
        String(raw.id),
        this.connection.id,
        internalOrderId,
      );
    } catch (err) {
      if (err instanceof DuplicateIdentifierMappingError) {
        const winners = await this.identifierMapping.getExternalIds(
          CORE_ENTITY_TYPE.Order,
          internalOrderId,
        );
        const winner = winners.find((e: ExternalIdMapping) => e.connectionId === this.connection.id);
        if (winner) {
          this.logger.warn(
            `createOrder: concurrent duplicate for ${internalOrderId} — returning winner WC ${winner.externalId}`,
          );
          return { orderId: internalOrderId };
        }
        throw err; // Transient state — let the job retry
      }
      throw err;
    }

    // Step 10
    return { orderId: internalOrderId, orderNumber: raw.number };
  }

  // ─── OrderFulfillmentUpdater ──────────────────────────────────────────────

  async updateFulfillment(input: {
    externalOrderId: string;
    status: OrderStatus;
    trackingNumber?: string;
  }): Promise<void> {
    this.logger.debug(
      `updateFulfillment: externalOrderId=${input.externalOrderId} status=${input.status} (connection: ${this.connection.id})`,
    );

    // Path-traversal defence — externalOrderId must be a bare positive integer string
    if (!/^\d+$/.test(input.externalOrderId)) {
      throw new WooCommerceResourceNotFoundException(
        `Invalid externalOrderId "${input.externalOrderId}" — expected a WC integer ID`,
        CORE_ENTITY_TYPE.Order,
        input.externalOrderId,
        this.connection.id,
      );
    }

    const wcStatus = WC_ORDER_STATUS_MAP[input.status];
    try {
      await this.httpClient.put<WooCommerceOrderUpdateRequest>(
        `/wp-json/wc/v3/orders/${input.externalOrderId}`,
        { status: wcStatus } satisfies WooCommerceOrderUpdateRequest,
      );
    } catch (err) {
      if (err instanceof WooCommerceHttpResponseException && err.statusCode === 404) {
        throw new WooCommerceResourceNotFoundException(
          `WooCommerce order ${input.externalOrderId} not found`,
          CORE_ENTITY_TYPE.Order,
          input.externalOrderId,
          this.connection.id,
        );
      }
      throw err;
    }

    if (input.trackingNumber) {
      // WC core has no tracking field. Future: write to WC Shipment Tracking plugin meta_data.
      this.logger.debug(
        `updateFulfillment: trackingNumber "${input.trackingNumber}" accepted but not persisted (WC has no core tracking field)`,
      );
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Resolves or provisions a WC customer account for the given OL internal customer.
   * Degrades to guest (customer_id = 0) on any non-auth failure to preserve order creation.
   */
  private async resolveCustomerId(
    order: OrderCreate,
    buyerEmail: string | undefined,
  ): Promise<number> {
    const { customerId } = order;
    if (!customerId) return 0;

    // 1. Look up existing WC customer mapping
    const externalIds = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Customer,
      customerId,
    );
    const mapping = externalIds.find((e: ExternalIdMapping) => e.connectionId === this.connection.id);
    if (mapping) {
      const n = Number(mapping.externalId);
      if (!Number.isInteger(n) || n <= 0) {
        this.logger.warn(
          `resolveCustomerId: corrupted mapping "${mapping.externalId}" for customer ${customerId} — guest order`,
        );
        return 0;
      }
      return n;
    }

    // 2. No existing mapping — provision WC customer if email is available
    if (!buyerEmail) {
      this.logger.warn(
        `resolveCustomerId: no WC mapping and no buyerEmail for customer ${customerId} — guest order`,
      );
      return 0;
    }

    const firstName = order.billingAddress?.firstName ?? order.shippingAddress?.firstName ?? '';
    const lastName = order.billingAddress?.lastName ?? order.shippingAddress?.lastName ?? '';

    let wcCustomerId: number;
    try {
      const created = await this.httpClient.post<WooCommerceCustomerResponse>(
        '/wp-json/wc/v3/customers',
        {
          email: buyerEmail,
          first_name: firstName,
          last_name: lastName,
        } satisfies WooCommerceCustomerCreateRequest,
      );
      if (!created.id) {
        this.logger.warn(
          `resolveCustomerId: WC customer POST returned no id for ${customerId} — guest order`,
        );
        return 0;
      }
      wcCustomerId = created.id;
    } catch (err) {
      if (err instanceof WooCommerceHttpResponseException && err.statusCode === 400) {
        // WC returns 400 + code 'registration-error-email-exists' for duplicate emails —
        // look up the existing customer account by email
        const existing = await this.httpClient.get<WooCommerceCustomerResponse[]>(
          '/wp-json/wc/v3/customers',
          { email: buyerEmail },
        );
        const match = existing.find((c) => c.email === buyerEmail);
        if (!match?.id) {
          this.logger.warn(
            `resolveCustomerId: duplicate email ${buyerEmail} but no matching WC customer — guest order`,
          );
          return 0;
        }
        wcCustomerId = match.id;
      } else {
        // Auth or network failure — degrade to guest, do not abort order creation
        this.logger.warn(
          `resolveCustomerId: WC customer API error for ${customerId} — guest order: ${String(err)}`,
        );
        return 0;
      }
    }

    // 3. Store Customer mapping with concurrent-duplicate handler
    try {
      await this.identifierMapping.createMapping(
        CORE_ENTITY_TYPE.Customer,
        String(wcCustomerId),
        this.connection.id,
        customerId,
      );
    } catch (err) {
      if (err instanceof DuplicateIdentifierMappingError) {
        // Concurrent retry stored it first — look up winner and return its id
        const winners = await this.identifierMapping.getExternalIds(
          CORE_ENTITY_TYPE.Customer,
          customerId,
        );
        const winner = winners.find((e: ExternalIdMapping) => e.connectionId === this.connection.id);
        if (winner) {
          const n = Number(winner.externalId);
          return Number.isInteger(n) && n > 0 ? n : 0;
        }
        // Transient — fall back to guest (do not fail the order)
        this.logger.warn(
          `resolveCustomerId: concurrent duplicate but no winner for ${customerId} — guest order`,
        );
        return 0;
      }
      throw err;
    }

    return wcCustomerId;
  }

  /**
   * Resolves all order items to WC line items.
   * Throws WooCommerceResourceNotFoundException if any product or variant mapping is missing
   * or contains a corrupted (non-integer) external ID — silent partial orders are not acceptable.
   *
   * N+1 trade-off: calls getExternalIds once per item (product + optionally variant).
   * IdentifierMappingPort has no batch-read method today; acceptable for MVP.
   */
  private async resolveLineItems(
    items: OrderItem[],
  ): Promise<WooCommerceLineItemRequest[]> {
    const lineItems: WooCommerceLineItemRequest[] = [];

    for (const item of items) {
      // Resolve product
      const productIds = await this.identifierMapping.getExternalIds(
        CORE_ENTITY_TYPE.Product,
        item.productId,
      );
      const productMapping = productIds.find((e: ExternalIdMapping) => e.connectionId === this.connection.id);
      if (!productMapping) {
        throw new WooCommerceResourceNotFoundException(
          `No WC product mapping for OL product ${item.productId} on connection ${this.connection.id}`,
          CORE_ENTITY_TYPE.Product,
          item.productId,
          this.connection.id,
        );
      }
      const productId = toPositiveInt(
        productMapping.externalId,
        CORE_ENTITY_TYPE.Product,
        item.productId,
        this.connection.id,
      );

      // Resolve variant (optional)
      let variationId: number | undefined;
      if (item.variantId) {
        const variantIds = await this.identifierMapping.getExternalIds(
          CORE_ENTITY_TYPE.ProductVariant,
          item.variantId,
        );
        const variantMapping = variantIds.find((e: ExternalIdMapping) => e.connectionId === this.connection.id);
        if (!variantMapping) {
          throw new WooCommerceResourceNotFoundException(
            `No WC variant mapping for OL variant ${item.variantId} on connection ${this.connection.id}`,
            CORE_ENTITY_TYPE.ProductVariant,
            item.variantId,
            this.connection.id,
          );
        }
        variationId = toPositiveInt(
          variantMapping.externalId,
          CORE_ENTITY_TYPE.ProductVariant,
          item.variantId,
          this.connection.id,
        );
      }

      lineItems.push({
        product_id: productId,
        ...(variationId !== undefined ? { variation_id: variationId } : {}),
        quantity: item.quantity,
        price: item.price.toFixed(2),
        ...(item.name ? { name: item.name } : {}),
      });
    }

    if (lineItems.length === 0) {
      throw new WooCommerceOrderProcessingException(
        `Cannot create WC order with empty line_items for connection ${this.connection.id}`,
        this.connection.id,
      );
    }

    return lineItems;
  }

  /** Builds WC shipping lines from order totals. Returns empty array when shipping cost is 0. */
  private buildShippingLines(order: OrderCreate): WooCommerceShippingLineRequest[] {
    if (!order.totals.shipping || order.totals.shipping <= 0) return [];
    return [
      {
        method_id: 'flat_rate',
        method_title: order.shipping?.methodName ?? 'Shipping',
        total: order.totals.shipping.toFixed(2),
      },
    ];
  }

  /** Maps an OL Address to a WC billing/shipping object. Returns undefined for absent addresses. */
  private mapAddress(address: Address | undefined): WooCommerceOrderAddress | undefined {
    if (!address) return undefined;
    return {
      first_name: address.firstName,
      last_name: address.lastName,
      company: address.company,
      address_1: address.address1,
      address_2: address.address2,
      city: address.city,
      state: address.state,
      postcode: address.postalCode,
      country: address.country,
      phone: address.phone,
    };
  }
}
