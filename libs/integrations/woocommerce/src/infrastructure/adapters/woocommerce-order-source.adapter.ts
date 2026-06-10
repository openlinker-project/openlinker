/**
 * WooCommerce Order Source Adapter
 *
 * Implements OrderSourcePort for WooCommerce REST API v3.
 * Uses modified_after watermark cursor — no event journal in WC.
 * Cursor key: woocommerce.orders.lastModifiedAfter
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters
 * @implements {OrderSourcePort}
 */
import type {
  OrderSourcePort,
  OrderFeedInput,
  OrderFeedOutput,
  OrderFeedItem,
  IncomingOrder,
  IncomingOrderItem,
  IncomingOrderItemRef,
  IncomingOrderAddress,
  IncomingOrderTotals,
  OrderFeedEventType,
} from '@openlinker/core/orders';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import type { IWooCommerceHttpClient } from '../http/woocommerce-http-client.interface';
import { WooCommerceHttpResponseException } from '../http/woocommerce-http-response.exception';
import { WooCommerceResourceNotFoundException } from '../../domain/exceptions/woocommerce-resource-not-found.exception';
import { normGmt } from '../utils/woocommerce-utils';
import type { WooCommerceConnectionConfig } from '../../domain/types/woocommerce-config.types';
import type {
  WooCommerceOrder,
  WooCommerceLineItem,
  WooCommerceBillingAddress,
  WooCommerceShippingAddress,
} from './order-source/woocommerce-order.types';

export class WooCommerceOrderSourceAdapter implements OrderSourcePort {
  private readonly logger = new Logger(WooCommerceOrderSourceAdapter.name);

  constructor(
    private readonly httpClient: IWooCommerceHttpClient,
    private readonly connection: Connection,
  ) {}

  async listOrderFeed(input: OrderFeedInput): Promise<OrderFeedOutput> {
    this.logger.debug('Listing WooCommerce order feed', {
      connectionId: this.connection.id,
      fromCursor: input.fromCursor ?? 'none',
      limit: input.limit,
    });

    const params: Record<string, string | number | boolean> = {
      per_page: input.limit,
      orderby: 'modified',
      order: 'asc',
    };

    if (input.fromCursor) {
      params.modified_after = input.fromCursor;
      // The cursor is a GMT timestamp (date_modified_gmt, Z-normalized). WC
      // interprets modified_after in the SITE's local timezone unless this flag
      // is set — so without it, orders modified in the local-offset window are
      // silently skipped for shops west of GMT (the cursor has already advanced).
      params.dates_are_gmt = true;
    } else {
      const config = (this.connection.config ?? {}) as unknown as WooCommerceConnectionConfig;
      const initial = config.orders?.initialSyncFrom;
      if (initial) {
        params.modified_after = new Date(initial).toISOString();
        params.dates_are_gmt = true;
      }
      // No modified_after = fetch all historical orders (intentional boot behaviour)
    }

    const orders = await this.httpClient.get<WooCommerceOrder[]>(
      '/wp-json/wc/v3/orders',
      params,
    );

    if (orders.length === 0) {
      return { items: [], nextCursor: input.fromCursor ?? null };
    }

    // Cursor computed over ALL orders before filtering — prevents cursor freeze
    // when every item is filtered out by eventTypes.
    const nextCursor = orders.reduce<string | null>((acc, o) => {
      const ts = normGmt(o.date_modified_gmt, o.date_modified);
      return !acc || ts > acc ? ts : acc;
    }, null);

    const items: OrderFeedItem[] = orders.map((o) => {
      const occurredAt = normGmt(o.date_modified_gmt, o.date_modified);
      const createdAt = normGmt(o.date_created_gmt, o.date_created);
      return {
        externalOrderId: String(o.id),
        eventType: mapWooCommerceEventType(o.status, occurredAt === createdAt),
        occurredAt,
        eventKey: `${o.id}:${o.status}`,
      };
    });

    const { eventTypes } = input;
    const filtered = eventTypes ? items.filter((i) => eventTypes.includes(i.eventType)) : items;

    return { items: filtered, nextCursor: nextCursor ?? input.fromCursor ?? null };
  }

  async getOrder(input: { externalOrderId: string }): Promise<IncomingOrder> {
    const { externalOrderId } = input;

    // WC order IDs are always positive integers.
    // Reject anything else before URL construction to prevent path issues.
    if (!/^\d+$/.test(externalOrderId)) {
      throw new WooCommerceResourceNotFoundException(
        `WooCommerce order not found: ${externalOrderId}`,
        'Order',
        externalOrderId,
        this.connection.id,
      );
    }

    this.logger.debug('Fetching WooCommerce order', {
      connectionId: this.connection.id,
      externalOrderId,
    });

    let order: WooCommerceOrder;
    try {
      order = await this.httpClient.get<WooCommerceOrder>(
        `/wp-json/wc/v3/orders/${externalOrderId}`,
      );
    } catch (error) {
      if (error instanceof WooCommerceHttpResponseException && error.statusCode === 404) {
        throw new WooCommerceResourceNotFoundException(
          `WooCommerce order not found: ${externalOrderId} on connection ${this.connection.id}`,
          'Order',
          externalOrderId,
          this.connection.id,
        );
      }
      // WooCommerceUnauthorizedException (401/403) → auth failure classifier
      // WooCommerceNetworkException → retry classifier
      // WooCommerceHttpResponseException (5xx) → retry classifier
      throw error;
    }

    return {
      externalOrderId,
      orderNumber: order.number,
      status: order.status,
      customerExternalId: order.customer_id > 0 ? String(order.customer_id) : undefined,
      customerEmail: order.billing.email || undefined,
      items: order.line_items.map(mapLineItem),
      totals: mapTotals(order),
      shippingAddress: mapShippingAddress(order.shipping),
      billingAddress: mapBillingAddress(order.billing),
      shipping: order.shipping_lines[0]
        ? {
            methodId: order.shipping_lines[0].method_id,
            methodName: order.shipping_lines[0].method_title,
          }
        : undefined,
      createdAt: normGmt(order.date_created_gmt, order.date_created),
      updatedAt: normGmt(order.date_modified_gmt, order.date_modified),
    };
  }
}

// ─── module-level helpers (not exported) ────────────────────────────────────

function mapWooCommerceEventType(status: string, isNew: boolean): OrderFeedEventType {
  const s = status.toLowerCase();
  // WC `failed` is a recoverable *payment* failure (the order itself is not
  // cancelled), so it maps to `updated` rather than `cancelled` — otherwise a
  // transient payment hiccup would cancel the destination order. Only the
  // genuinely-terminal `cancelled`/`refunded` statuses map to `cancelled`.
  if (s === 'cancelled' || s === 'refunded') return 'cancelled';
  if (s === 'processing') return 'paid';
  if (isNew) return 'created';
  return 'updated';
}

function mapLineItem(item: WooCommerceLineItem): IncomingOrderItem {
  const productRef: IncomingOrderItemRef =
    item.variation_id > 0
      ? { type: 'variant', externalId: String(item.variation_id) }
      : item.product_id > 0
        ? { type: 'product', externalId: String(item.product_id) }
        : item.sku
          ? { type: 'sku', externalId: item.sku }
          : { type: 'sku', externalId: String(item.id) };

  return {
    id: String(item.id),
    productRef,
    quantity: item.quantity,
    price: roundCurrency(Number(item.price)),
    sku: item.sku || undefined,
    name: item.name || undefined,
    imageUrl: item.image?.src || undefined,
  };
}

function mapBaseAddress(
  addr: WooCommerceShippingAddress | WooCommerceBillingAddress,
): Omit<IncomingOrderAddress, 'phone'> {
  return {
    firstName: addr.first_name || undefined,
    lastName: addr.last_name || undefined,
    company: addr.company || undefined,
    address1: addr.address_1,
    address2: addr.address_2 || undefined,
    city: addr.city,
    state: addr.state || undefined,
    postalCode: addr.postcode,
    country: addr.country,
  };
}

function mapShippingAddress(addr: WooCommerceShippingAddress): IncomingOrderAddress {
  return mapBaseAddress(addr);
}

function mapBillingAddress(addr: WooCommerceBillingAddress): IncomingOrderAddress {
  return { ...mapBaseAddress(addr), phone: addr.phone || undefined };
}

function mapTotals(order: WooCommerceOrder): IncomingOrderTotals {
  const total = Number(order.total);
  const tax = Number(order.total_tax);
  const shipping = Number(order.shipping_total);
  // WC has no order-level subtotal. Derived: total - tax - shipping
  // = sum(line_items[].total) — post-discount product amount.
  return {
    subtotal: roundCurrency(total - tax - shipping),
    tax: roundCurrency(tax),
    shipping: roundCurrency(shipping),
    total: roundCurrency(total),
    currency: order.currency,
  };
}

function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}
