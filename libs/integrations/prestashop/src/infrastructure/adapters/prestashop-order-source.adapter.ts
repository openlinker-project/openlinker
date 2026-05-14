/**
 * PrestaShop Order Source Adapter
 *
 * Implements `OrderSourcePort` for PrestaShop WebService API. Provides
 * incremental order-feed ingestion (via `date_upd` watermark cursor) and
 * full-order hydration into the neutral `IncomingOrder` shape. Enables
 * PrestaShop as an order source alongside marketplace sources (Allegro).
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters
 * @implements {OrderSourcePort}
 */
import type {
  OrderSourcePort,
  OrderFeedInput,
  OrderFeedOutput,
  OrderFeedItem,
  IncomingOrder,
  IncomingOrderItem,
  IncomingOrderAddress,
} from '@openlinker/core/orders';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import type {
  IPrestashopOrderMapper,
  PrestashopOrder,
  PrestashopOrderRow,
} from '../mappers/prestashop.mapper.interface';
import {
  PrestashopApiException,
  PrestashopResourceNotFoundException,
} from '@openlinker/integrations-prestashop';
import { Logger } from '@openlinker/shared/logging';

/**
 * PrestaShop Order Source Adapter
 *
 * Read-only adapter for fetching PrestaShop orders.
 *
 * Cursor format: ISO timestamp of the last `date_upd` observed on the previous
 * page. `null` input means "start from the beginning" (no watermark filter).
 */
export class PrestashopOrderSourceAdapter implements OrderSourcePort {
  private readonly logger = new Logger(PrestashopOrderSourceAdapter.name);

  constructor(
    private readonly httpClient: IPrestashopWebserviceClient,
    private readonly orderMapper: IPrestashopOrderMapper,
    private readonly connection: Connection
  ) {}

  async listOrderFeed(input: OrderFeedInput): Promise<OrderFeedOutput> {
    this.logger.debug(
      `Listing PrestaShop order feed (connection: ${this.connection.id}, fromCursor: ${input.fromCursor ?? 'none'}, limit: ${input.limit})`
    );

    const filters: { updatedSince?: Date } = {};
    if (input.fromCursor) {
      const parsed = new Date(input.fromCursor);
      if (!Number.isNaN(parsed.getTime())) {
        filters.updatedSince = parsed;
      }
    }

    const prestashopOrders = await this.httpClient.listResources<PrestashopOrder>(
      'orders',
      filters,
      input.limit,
      0
    );

    if (prestashopOrders.length === 0) {
      return { items: [], nextCursor: input.fromCursor ?? null };
    }

    const items: OrderFeedItem[] = prestashopOrders.map((o) => {
      const externalOrderId = String(o.id);
      const occurredAt = typeof o.date_upd === 'string' ? o.date_upd : new Date().toISOString();
      const createdAt = typeof o.date_add === 'string' ? o.date_add : occurredAt;
      const eventType = createdAt === occurredAt ? 'created' : 'updated';
      return {
        externalOrderId,
        eventType,
        occurredAt,
        // PrestaShop has no event journal; a composite key gives us dedupe-safe ingestion.
        eventKey: `${externalOrderId}:${occurredAt}:${eventType}`,
      };
    });

    // Advance the cursor to the max `date_upd` observed on this page. Cursor is
    // based on ALL orders returned by PrestaShop, not just those matching
    // `eventTypes` — otherwise filtering everything out on a page would freeze
    // the cursor at `input.fromCursor` and the next poll would re-fetch the
    // same orders forever.
    const nextCursor = items.reduce<string | null>((acc, item) => {
      return !acc || item.occurredAt > acc ? item.occurredAt : acc;
    }, null);

    // Filter `items` by requested eventTypes only after cursor is computed.
    const filtered = input.eventTypes
      ? items.filter((i) => input.eventTypes!.includes(i.eventType))
      : items;

    return {
      items: filtered,
      nextCursor: nextCursor ?? input.fromCursor ?? null,
    };
  }

  async getOrder(input: { externalOrderId: string }): Promise<IncomingOrder> {
    const { externalOrderId } = input;
    this.logger.debug(
      `Fetching PrestaShop order: ${externalOrderId} (connection: ${this.connection.id})`
    );

    let prestashopOrder: PrestashopOrder;
    try {
      prestashopOrder = await this.httpClient.getResource<PrestashopOrder>(
        'orders',
        externalOrderId
      );
    } catch (error) {
      // Only translate 404 to ResourceNotFound. Transport / auth / 5xx errors
      // propagate unchanged so upstream retry + incident handling can tell the
      // difference between a genuinely-missing order and a platform outage.
      if (error instanceof PrestashopApiException && error.statusCode === 404) {
        throw new PrestashopResourceNotFoundException(
          `Order not found: ${externalOrderId} on connection ${this.connection.id}`,
          'Order',
          externalOrderId,
          this.connection.id
        );
      }
      throw error;
    }

    const orderRows = await this.fetchOrderRows(externalOrderId);
    const mapped = this.orderMapper.mapOrder(prestashopOrder, orderRows);

    const items: IncomingOrderItem[] = mapped.items.map((item, index) => {
      const row = orderRows[index];
      const externalId =
        row?.product_attribute_id && String(row.product_attribute_id) !== '0'
          ? String(row.product_attribute_id)
          : row?.product_id
            ? String(row.product_id)
            : item.sku ?? item.productId ?? `${externalOrderId}-item-${index}`;
      const refType: 'variant' | 'product' | 'sku' =
        row?.product_attribute_id && String(row.product_attribute_id) !== '0'
          ? 'variant'
          : row?.product_id
            ? 'product'
            : 'sku';
      return {
        id: item.id,
        productRef: { type: refType, externalId },
        quantity: item.quantity,
        price: item.price,
        sku: item.sku,
      };
    });

    const createdAtIso =
      typeof prestashopOrder.date_add === 'string'
        ? prestashopOrder.date_add
        : mapped.createdAt.toISOString();
    const updatedAtIso =
      typeof prestashopOrder.date_upd === 'string'
        ? prestashopOrder.date_upd
        : mapped.updatedAt.toISOString();

    return {
      externalOrderId,
      orderNumber: mapped.orderNumber,
      status: mapped.status,
      customerExternalId:
        prestashopOrder.id_customer !== undefined ? String(prestashopOrder.id_customer) : undefined,
      items,
      totals: mapped.totals,
      shippingAddress: mapped.shippingAddress as IncomingOrderAddress | undefined,
      billingAddress: mapped.billingAddress as IncomingOrderAddress | undefined,
      createdAt: createdAtIso,
      updatedAt: updatedAtIso,
    };
  }

  private async fetchOrderRows(orderId: string | number): Promise<PrestashopOrderRow[]> {
    try {
      return await this.httpClient.listResources<PrestashopOrderRow>('order_rows', {
        custom: { id_order: orderId },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to fetch order rows for order ${orderId}: ${(error as Error).message}`
      );
      return [];
    }
  }
}
