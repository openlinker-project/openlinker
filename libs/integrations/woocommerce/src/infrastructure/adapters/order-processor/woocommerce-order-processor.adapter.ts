/**
 * WooCommerce Order Processor Adapter
 *
 * Implements OrderProcessorManagerPort (createOrder) and the OrderFulfillmentUpdater
 * sub-capability (updateFulfillment — status updates, cancellations, refund transitions)
 * for WooCommerce REST API v3.
 *
 * Key design decisions:
 * - createOrder: the adapter does NOT dedup. It POSTs to WC and returns the
 *   WC-native order id (#877). The `_ol_order_id` meta_data it stamps is a
 *   forensic/recovery marker only (WC REST cannot filter orders by meta_data
 *   without an extension, so it cannot be read back as a skip-check). Real
 *   idempotency is core-owned: OrderSyncService's per-(order,destination) lock
 *   (#906) + update-or-create mapping check (#909).
 * - Customer provisioning: POST /customers with email when available.
 *   auth failures (401/403) propagate as WooCommerceAuthFailureException — they
 *   are NOT swallowed into guest-order creation (#877).
 * - buyerEmail: WooCommerce adapter reads buyer email from order.metadata?.buyerEmail,
 *   which OrderSyncService populates from the source order's customerEmail (#948).
 *   When absent (hash-only PII mode, or a source without an email), customer
 *   provisioning degrades to guest (customer_id = 0).
 * - destination_address_mappings: not applicable — WC has no address entities; addresses
 *   are embedded inline in the order payload.
 * - DuplicateIdentifierMappingError: not applicable here — mapping writes are in
 *   OrderSyncService.
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
import { WooCommerceUnauthorizedException } from '../../../domain/exceptions/woocommerce-unauthorized.exception';
import { WooCommerceAuthFailureException } from '../../../domain/exceptions/woocommerce-auth-failure.exception';
import { WooCommerceResourceNotFoundException } from '../../../domain/exceptions/woocommerce-resource-not-found.exception';
import { WooCommerceOrderProcessingException } from '../../../domain/exceptions/woocommerce-order-processing.exception';
import { WooCommerceInvalidArgumentException } from '../../../domain/exceptions/woocommerce-invalid-argument.exception';
import { WooCommerceInvalidIdentifierException } from '../../../domain/exceptions/woocommerce-invalid-identifier.exception';
import { toPositiveInt } from '../../utils/woocommerce-utils';
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

    // Step 1 — extract and validate buyer email from order metadata.
    // OrderSyncService populates metadata.buyerEmail from the source order's
    // customerEmail (#948); absent in hash-only PII mode or emailless sources.
    const rawEmail = order.metadata?.buyerEmail;
    const buyerEmail = isValidEmail(rawEmail) ? rawEmail : undefined;
    if (!buyerEmail) {
      this.logger.debug(
        `createOrder: billing.email absent or invalid — WC order confirmation will not be sent`,
      );
    }

    // Step 2 — resolve or provision WC customer
    const customerId = await this.resolveCustomerId(order, buyerEmail);

    // Step 3 — resolve line items (throws on any unresolvable or corrupted mapping)
    const lineItems = await this.resolveLineItems(order.items);

    // Step 4 — build shipping lines
    const shippingLines = this.buildShippingLines(order);

    // Step 5 — build WC order payload.
    // _ol_order_id is a forensic/recovery marker only — NOT a dedup guard. WC REST
    // cannot filter orders by meta_data without an extension, so the adapter cannot
    // (and must not) read it back to skip a duplicate. Real idempotency is owned by
    // core's OrderSyncService — the per-(order,destination) lock (#906) plus the
    // update-or-create mapping check (#909). The marker only lets operators or
    // recovery tooling identify the WC order an OL order produced when a response is
    // lost after a successful POST.
    const internalOrderId = order.metadata?.internalOrderId;

    // Gate set_paid: only mark paid for fulfilled/in-progress states. A pending,
    // cancelled, or refunded order must not be flipped to paid (WC's set_paid:true
    // forces the order into a paid state and stamps date_paid regardless of status).
    const markPaid =
      order.status !== 'pending' && order.status !== 'cancelled' && order.status !== 'refunded';

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
      ...(markPaid ? { set_paid: true } : {}),
      ...(typeof internalOrderId === 'string' && internalOrderId.length > 0
        ? { meta_data: [{ key: '_ol_order_id', value: internalOrderId }] }
        : {}),
    };

    // Step 6 — create WC order; return WC-native id as orderId (#877 B2).
    // Identifier-mapping (OL idempotency) and order-mapping writes are owned by
    // OrderSyncService — not the adapter's concern.
    const raw = await this.httpClient.post<WooCommerceOrderResponse>(
      '/wp-json/wc/v3/orders',
      payload,
    );

    if (raw.id === undefined) {
      throw new WooCommerceResourceNotFoundException(
        `WooCommerce returned order without ID`,
        CORE_ENTITY_TYPE.Order,
        `(${payload.status})`,
        this.connection.id,
      );
    }

    return { orderId: String(raw.id), orderNumber: raw.number };
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
      throw new WooCommerceInvalidArgumentException(
        `Invalid externalOrderId "${input.externalOrderId}" — expected a WC integer ID`,
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
   * Degrades to guest (customer_id = 0) on non-auth, non-critical failure.
   * Auth failures (401/403) are NOT swallowed — they propagate as
   * WooCommerceAuthFailureException so the sync runner can flag the connection
   * for re-authentication (#877 I1).
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
      // Auth failures must propagate — invalid credentials require re-authentication.
      // Swallowing a 401/403 into a guest order masks a broken connection (#877 I1).
      if (err instanceof WooCommerceUnauthorizedException) {
        throw new WooCommerceAuthFailureException(
          `WooCommerce auth failure provisioning customer ${customerId} on connection ${this.connection.id}: ${String(err)}`,
          this.connection.id,
        );
      }
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
        // Non-auth, non-400 failure (network, rate-limit, etc.) — degrade to guest,
        // do not abort order creation.
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
      let productId: number;
      try {
        productId = toPositiveInt(productMapping.externalId, 'product id');
      } catch (err) {
        if (err instanceof WooCommerceInvalidIdentifierException) {
          throw new WooCommerceResourceNotFoundException(
            `Corrupted mapping: "${productMapping.externalId}" is not a valid positive integer WC ID for ${CORE_ENTITY_TYPE.Product} ${item.productId}`,
            CORE_ENTITY_TYPE.Product,
            item.productId,
            this.connection.id,
          );
        }
        throw err;
      }

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
        if (variantMapping.externalId.startsWith('product:')) {
          // Synthetic variant of a simple product (`product:{wcId}` — same
          // convention as PrestaShop; the inventory adapter strips this
          // prefix too). Simple products have no WC variation — the line
          // item is the product itself, so variation_id stays unset.
        } else {
          try {
            variationId = toPositiveInt(variantMapping.externalId, 'variation id');
          } catch (err) {
            if (err instanceof WooCommerceInvalidIdentifierException) {
              throw new WooCommerceResourceNotFoundException(
                `Corrupted mapping: "${variantMapping.externalId}" is not a valid positive integer WC ID for ${CORE_ENTITY_TYPE.ProductVariant} ${item.variantId}`,
                CORE_ENTITY_TYPE.ProductVariant,
                item.variantId,
                this.connection.id,
              );
            }
            throw err;
          }
        }
      }

      // Pin buyer-paid price via subtotal/total. WC REST line_items.price is read-only
      // (reflects catalog price); subtotal/total carry the actual buyer-paid amounts.
      const lineSubtotal = (item.price * item.quantity).toFixed(2);
      const lineTotal = lineSubtotal;

      lineItems.push({
        product_id: productId,
        ...(variationId !== undefined ? { variation_id: variationId } : {}),
        quantity: item.quantity,
        subtotal: lineSubtotal,
        total: lineTotal,
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

  /**
   * Maps an OL Address to a WC billing/shipping object. Returns undefined for
   * absent addresses. Nullish fields are OMITTED, not passed through — WC REST
   * type-checks address properties as strings and rejects the whole request
   * with `rest_invalid_param: shipping[company] is not of type string` when a
   * source platform (e.g. Allegro) carries `null` for an optional field.
   */
  private mapAddress(address: Address | undefined): WooCommerceOrderAddress | undefined {
    if (!address) return undefined;
    const mapped: WooCommerceOrderAddress = {};
    const assign = (key: keyof WooCommerceOrderAddress, value: string | null | undefined): void => {
      if (value !== null && value !== undefined) mapped[key] = value;
    };
    assign('first_name', address.firstName);
    assign('last_name', address.lastName);
    assign('company', address.company);
    assign('address_1', address.address1);
    assign('address_2', address.address2);
    assign('city', address.city);
    assign('state', address.state);
    assign('postcode', address.postalCode);
    assign('country', address.country);
    assign('phone', address.phone);
    return mapped;
  }
}
