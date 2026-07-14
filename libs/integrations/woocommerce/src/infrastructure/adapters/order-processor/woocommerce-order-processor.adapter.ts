/**
 * WooCommerce Order Processor Adapter
 *
 * Implements OrderProcessorManagerPort (createOrder), the OrderFulfillmentUpdater
 * sub-capability (updateFulfillment — status updates, cancellations, refund transitions),
 * the OrderStatusWriteback sub-capability (write — the #1157 / ADR-027 lifecycle
 * relay contract), the DestinationOptionsReader sub-capability (listCarriers /
 * listOrderStatuses / listPaymentMethods — the #472 / #1551 mapping-UI option
 * vocabulary), and the FulfillmentStatusReader sub-capability (getFulfillmentStatus
 * — the #834 / #1550 read-back of the shop's fulfillment view) for WooCommerce REST
 * API v3.
 *
 * Key design decisions:
 * - createOrder: the adapter does NOT dedup. It POSTs to WC and returns the
 *   WC-native order id (#877). The `_ol_order_id` meta_data it stamps is a
 *   forensic/recovery marker only (WC REST cannot filter orders by meta_data
 *   without an extension, so it cannot be read back as a skip-check). Real
 *   idempotency is core-owned: OrderSyncService's per-(order,destination) lock
 *   (#906) + update-or-create mapping check (#909).
 * - Customer provisioning: delegated to WooCommerceCustomerProvisioner
 *   (resolve-or-create under a distributed lock; #1552). Auth failures (401/403)
 *   propagate as WooCommerceAuthFailureException — they are NOT swallowed into
 *   guest-order creation (#877).
 * - buyerEmail: WooCommerce adapter reads buyer email from order.metadata?.buyerEmail,
 *   which OrderSyncService populates from the source order's customerEmail (#948).
 *   When absent (hash-only PII mode, or a source without an email), customer
 *   provisioning degrades to guest (customer_id = 0).
 * - Address reuse: delegated to WooCommerceAddressProvisioner (#1552). WC has no
 *   standalone address resource — the provisioner writes the customer's inline
 *   billing/shipping address at most once per (customer, addressHash, type) using
 *   destination_address_mappings, guarded by the same distributed lock. Best-effort:
 *   a provisioning failure is logged and never aborts order creation. The order
 *   payload always carries the inline address regardless.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/order-processor
 * @implements {OrderProcessorManagerPort}
 * @implements {OrderFulfillmentUpdater}
 * @implements {OrderStatusWriteback}
 * @implements {DestinationOptionsReader}
 * @implements {FulfillmentStatusReader}
 */
import type {
  OrderProcessorManagerPort,
  OrderCreate,
  OrderRef,
  OrderItem,
  Address,
  OrderStatus,
} from '@openlinker/core/orders';
import type {
  OrderFulfillmentUpdater,
  OrderStatusWriteback,
  OrderLifecycleEvent,
  OrderWritebackResult,
  DestinationOptionsReader,
  MappingOption,
  FulfillmentStatusReader,
  FulfillmentStatusSnapshot,
} from '@openlinker/core/orders';
import type { IdentifierMappingPort, Connection, ExternalIdMapping } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import type { CustomerProjectionRepositoryPort, AddressType } from '@openlinker/core/customers';
import { Logger } from '@openlinker/shared/logging';
import type { IWooCommerceHttpClient } from '../../http/woocommerce-http-client.interface';
import { WooCommerceHttpResponseException } from '../../http/woocommerce-http-response.exception';
import { WooCommerceResourceNotFoundException } from '../../../domain/exceptions/woocommerce-resource-not-found.exception';
import { WooCommerceOrderProcessingException } from '../../../domain/exceptions/woocommerce-order-processing.exception';
import { WooCommerceInvalidArgumentException } from '../../../domain/exceptions/woocommerce-invalid-argument.exception';
import { WooCommerceInvalidIdentifierException } from '../../../domain/exceptions/woocommerce-invalid-identifier.exception';
import { toPositiveInt } from '../../utils/woocommerce-utils';
import type { WooCommerceCustomerProvisioner } from '../../provisioners/woocommerce-customer-provisioner';
import type { WooCommerceAddressProvisioner } from '../../provisioners/woocommerce-address-provisioner';
import type {
  WooCommerceOrderCreateRequest,
  WooCommerceOrderUpdateRequest,
  WooCommerceOrderResponse,
  WooCommerceOrderAddress,
  WooCommerceLineItemRequest,
  WooCommerceShippingLineRequest,
} from './woocommerce-order.types';
import { WC_ORDER_STATUS_MAP, WC_ORDER_STATUS_VALUES } from './woocommerce-order.types';
import {
  WC_ORDER_STATUS_LABELS,
  type WooCommercePaymentGateway,
  type WooCommerceShippingMethod,
} from './woocommerce-options.types';
import { mapToFulfillmentStatusSnapshot } from './woocommerce-fulfillment-status.mapper';

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
  implements
    OrderProcessorManagerPort,
    OrderFulfillmentUpdater,
    OrderStatusWriteback,
    DestinationOptionsReader,
    FulfillmentStatusReader
{
  private readonly logger = new Logger(WooCommerceOrderProcessorAdapter.name);

  constructor(
    private readonly httpClient: IWooCommerceHttpClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly connection: Connection,
    private readonly customerProvisioner: WooCommerceCustomerProvisioner,
    private readonly addressProvisioner: WooCommerceAddressProvisioner,
    private readonly customerProjectionRepository: CustomerProjectionRepositoryPort,
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

    // Step 2 — resolve or provision WC customer (delegated to the provisioner,
    // which serializes concurrent provisioning for the same buyer under a lock).
    const firstName = order.billingAddress?.firstName ?? order.shippingAddress?.firstName ?? '';
    const lastName = order.billingAddress?.lastName ?? order.shippingAddress?.lastName ?? '';
    const customerId = await this.customerProvisioner.resolveOrCreateCustomer({
      internalCustomerId: order.customerId,
      buyerEmail,
      firstName,
      lastName,
      connectionId: this.connection.id,
      httpClient: this.httpClient,
      identifierMapping: this.identifierMapping,
    });

    // Step 2b — reuse-tracked address provisioning (best-effort; #1552). Records
    // the WC customer's inline billing/shipping address for reuse without ever
    // aborting order creation. Skipped for guest orders (customer_id = 0).
    if (customerId > 0 && order.customerId) {
      await this.provisionAddresses(order, order.customerId, customerId);
    }

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

  // ─── OrderStatusWriteback ─────────────────────────────────────────────────

  /**
   * `OrderStatusWriteback` (#1157 / ADR-027): the single event-as-data writeback
   * the lifecycle relay dispatches through. Maps each neutral lifecycle event
   * onto WooCommerce's order status and PUTs it via `PUT /orders/{id}`.
   *
   * Never throws — the outcome is reported via `OrderWritebackResult`:
   * - `dispatched` → set WC status `completed` (delegates to `updateFulfillment`,
   *   the same neutral-`shipped` → WC-`completed` mapping). `applied`.
   * - `cancelled`  → refuse (`rejected`) if WC has already reached a terminal
   *   fulfilled state (`completed` / `refunded`) — the shop is authoritative for
   *   its own live state, so we surface the conflict rather than force a
   *   regressive transition. Idempotent when already `cancelled`. Otherwise PUT
   *   `cancelled`. `applied`.
   */
  async write(event: OrderLifecycleEvent): Promise<OrderWritebackResult> {
    try {
      if (!/^\d+$/.test(event.externalOrderId)) {
        return {
          outcome: 'rejected',
          detail: `Invalid externalOrderId "${event.externalOrderId}" — expected a WC integer ID`,
        };
      }

      if (event.type === 'dispatched') {
        await this.updateFulfillment({
          externalOrderId: event.externalOrderId,
          status: 'shipped',
          trackingNumber: event.trackingNumber,
        });
        return { outcome: 'applied' };
      }

      // event.type === 'cancelled' — one read to honour the shop's authoritative
      // live state before forcing a regressive transition.
      const order = await this.httpClient.get<WooCommerceOrderResponse>(
        `/wp-json/wc/v3/orders/${event.externalOrderId}`,
      );
      const currentStatus = order.status;

      if (currentStatus === 'completed' || currentStatus === 'refunded') {
        this.logger.warn(
          `WooCommerce order ${event.externalOrderId} already in terminal state ` +
            `'${currentStatus}' — refusing cancel writeback (connection: ${this.connection.id})`,
        );
        return { outcome: 'rejected', detail: `order already ${currentStatus}` };
      }

      if (currentStatus === 'cancelled') {
        this.logger.debug(
          `WooCommerce order ${event.externalOrderId} already cancelled — cancel writeback is a no-op ` +
            `(connection: ${this.connection.id})`,
        );
        return { outcome: 'applied' };
      }

      const wcStatus = WC_ORDER_STATUS_MAP.cancelled;
      await this.httpClient.put<WooCommerceOrderUpdateRequest>(
        `/wp-json/wc/v3/orders/${event.externalOrderId}`,
        { status: wcStatus } satisfies WooCommerceOrderUpdateRequest,
      );
      return { outcome: 'applied' };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `OrderStatusWriteback '${event.type}' failed for WooCommerce order ` +
          `${event.externalOrderId}: ${detail} (connection: ${this.connection.id})`,
        error instanceof Error ? error.stack : undefined,
      );
      return { outcome: 'rejected', detail };
    }
  }

  // ─── DestinationOptionsReader (#472 / #1551) ──────────────────────────────
  //
  // Live option vocabulary powering the connection-mappings UI dropdowns. Each
  // method returns the neutral `MappingOption` shape ({ value, label }); `value`
  // is the stable identifier persisted by mapping config, `label` is the
  // operator-facing string.
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * WooCommerce core has no first-class carrier entity — shipping is modelled as
   * method *types* (`flat_rate`, `free_shipping`, `local_pickup`, plus any
   * plugin-provided types) attached to shipping zones, not named carriers.
   * `GET /shipping_methods` returns those globally-registered method types, which
   * is the closest live analogue to a carrier list and gives the mapping UI a
   * non-empty, stable set to map onto (rather than an empty dropdown). `value` is
   * the WC method id — the same code createOrder emits as `shipping_lines.method_id`.
   */
  async listCarriers(): Promise<MappingOption[]> {
    const rows = await this.httpClient.get<WooCommerceShippingMethod[]>(
      '/wp-json/wc/v3/shipping_methods',
    );
    return rows.map((row) => ({
      value: String(row.id),
      label: row.title ?? String(row.id),
    }));
  }

  /**
   * WooCommerce exposes no dedicated order-status catalogue endpoint — the core
   * status set is fixed by the WC REST API v3 contract. Enumerate the shared
   * vocabulary (`WC_ORDER_STATUS_VALUES`) decorated with display labels; `value`
   * is the WC status slug persisted by mapping config.
   */
  listOrderStatuses(): Promise<MappingOption[]> {
    return Promise.resolve(
      WC_ORDER_STATUS_VALUES.map((slug) => ({
        value: slug,
        label: WC_ORDER_STATUS_LABELS[slug],
      })),
    );
  }

  /**
   * `GET /payment_gateways` lists every payment gateway registered in the store.
   * `value` is the gateway code (`bacs`, `cod`, `paypal`, …) persisted by mapping
   * config; `label` is the operator-facing title. All registered gateways are
   * returned regardless of `enabled` — an operator may legitimately map a source
   * payment method onto a currently-disabled destination gateway.
   */
  async listPaymentMethods(): Promise<MappingOption[]> {
    const rows = await this.httpClient.get<WooCommercePaymentGateway[]>(
      '/wp-json/wc/v3/payment_gateways',
    );
    return rows.map((row) => ({
      value: String(row.id),
      label: row.title ?? String(row.id),
    }));
  }

  // ─── FulfillmentStatusReader ──────────────────────────────────────────────

  /**
   * `FulfillmentStatusReader` (#834 / #1550): read the shop's view of an
   * order's fulfillment progress. GETs `/orders/{id}`, reads the WC `status`,
   * and maps it to the neutral `FulfillmentStatusSnapshot` via
   * {@link mapToFulfillmentStatusSnapshot}.
   *
   * `status` is `null` when the shop has not yet fulfilled the order
   * (`pending` / `processing` / `on-hold` / `failed`) — the branch-1 sync
   * service treats that as "no shipment to project, skip this pass".
   * `trackingNumber` is always `null` (WC core carries no order-level tracking
   * field). `externalOrderId` is the WC-native numeric order id.
   */
  async getFulfillmentStatus(input: {
    externalOrderId: string;
  }): Promise<FulfillmentStatusSnapshot> {
    this.logger.debug(
      `getFulfillmentStatus: externalOrderId=${input.externalOrderId} (connection: ${this.connection.id})`,
    );

    // Path-traversal defence — externalOrderId must be a bare positive integer string.
    if (!/^\d+$/.test(input.externalOrderId)) {
      throw new WooCommerceInvalidArgumentException(
        `Invalid externalOrderId "${input.externalOrderId}" — expected a WC integer ID`,
      );
    }

    try {
      const order = await this.httpClient.get<WooCommerceOrderResponse>(
        `/wp-json/wc/v3/orders/${input.externalOrderId}`,
      );
      return mapToFulfillmentStatusSnapshot(order);
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
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Best-effort reuse-tracked provisioning of the WC customer's inline billing
   * and shipping addresses (#1552). Delegates to WooCommerceAddressProvisioner
   * per address type. Failures are logged and swallowed — address reuse tracking
   * is auxiliary and must never abort order creation.
   */
  private async provisionAddresses(
    order: OrderCreate,
    internalCustomerId: string,
    wcCustomerId: number,
  ): Promise<void> {
    const targets: Array<{ address: Address | undefined; type: AddressType }> = [
      { address: order.billingAddress, type: 'billing' },
      { address: order.shippingAddress, type: 'shipping' },
    ];

    for (const { address, type } of targets) {
      if (!address) continue;
      try {
        await this.addressProvisioner.resolveOrCreateAddress({
          internalCustomerId,
          wcCustomerId,
          address,
          addressType: type,
          connectionId: this.connection.id,
          httpClient: this.httpClient,
          customerProjectionRepository: this.customerProjectionRepository,
        });
      } catch (err) {
        this.logger.warn(
          `provisionAddresses: ${type} address reuse tracking failed for customer ${internalCustomerId} — continuing: ${String(err)}`,
        );
      }
    }
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
