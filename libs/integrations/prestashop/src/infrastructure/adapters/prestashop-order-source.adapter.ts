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
  OrderFeedEventType,
  IncomingOrder,
  IncomingOrderItem,
  IncomingOrderAddress,
  OrderPickupPoint,
} from '@openlinker/core/orders';
import type { PrestashopConnectionConfig } from '../../domain/types/prestashop-config.types';
import type { PrestashopAddress } from '../provisioners/prestashop-provisioner.types';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import type {
  IPrestashopOrderMapper,
  PrestashopOrder,
  PrestashopOrderRow,
} from '../mappers/prestashop.mapper.interface';
import { PRESTASHOP_DEFAULT_CANCELLED_STATE_ID } from '../mappers/prestashop-order-state.types';
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
      const eventType = this.resolveFeedEventType(o, createdAt, occurredAt);
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

  /**
   * Derive the feed event type for a PrestaShop order row.
   *
   * Cancellation is checked **first**, with precedence over created/updated.
   * This ordering is load-bearing, not cosmetic: an order that stays cancelled
   * but gets re-touched at the source (admin note, status-history write — any
   * `date_upd` bump) must keep emitting `cancelled`. If it ever flipped to
   * `updated`, `OrderIngestionService.syncOrderFromSource` would re-enter the
   * create/update path and resurrect a cancelled order as active (#1161). A
   * still-cancelled order therefore re-emits `cancelled` (an idempotent no-op
   * at the lifecycle relay) on every re-read — never `updated`.
   *
   * Keys on the default-install "Canceled" state id; renumbered installs are a
   * documented v1 limitation (see `prestashop-order-state.types.ts`).
   */
  private resolveFeedEventType(
    order: PrestashopOrder,
    createdAt: string,
    occurredAt: string
  ): OrderFeedEventType {
    if (
      order.current_state !== undefined &&
      Number(order.current_state) === PRESTASHOP_DEFAULT_CANCELLED_STATE_ID
    ) {
      return 'cancelled';
    }
    return createdAt === occurredAt ? 'created' : 'updated';
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
          CORE_ENTITY_TYPE.Order,
          externalOrderId,
          this.connection.id
        );
      }
      throw error;
    }

    const orderRows = await this.fetchOrderRows(externalOrderId);
    const mapped = this.orderMapper.mapOrder(prestashopOrder, orderRows);
    const config = this.connection.config as unknown as PrestashopConnectionConfig;
    const pickupPoint = await this.resolvePickupPoint(prestashopOrder, config);

    // The order JSON carries only address IDs, so the mapper cannot populate
    // billing/shipping bodies. Hydrate them from the address resources so
    // downstream consumers (e.g. invoicing buyer-profile derivation) have a
    // real address, incl. the B2B `company` field.
    const billingAddress =
      (mapped.billingAddress as IncomingOrderAddress | undefined) ??
      (await this.hydrateAddress(
        prestashopOrder.id_address_invoice as string | number | undefined
      ));
    const shippingAddress =
      (mapped.shippingAddress as IncomingOrderAddress | undefined) ??
      (await this.hydrateAddress(
        prestashopOrder.id_address_delivery
      )) ??
      billingAddress;

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
    // PrestaShop `date_add` is when the customer placed the order — the
    // buyer-placed time (#926). Undefined when the source row omits it.
    const placedAtIso =
      typeof prestashopOrder.date_add === 'string' ? prestashopOrder.date_add : undefined;

    return {
      externalOrderId,
      orderNumber: mapped.orderNumber,
      status: mapped.status,
      customerExternalId:
        prestashopOrder.id_customer !== undefined ? String(prestashopOrder.id_customer) : undefined,
      items,
      totals: mapped.totals,
      shippingAddress,
      billingAddress,
      placedAt: placedAtIso,
      createdAt: createdAtIso,
      updatedAt: updatedAtIso,
      pickupPoint,
    };
  }

  /**
   * Paczkomat code format: three uppercase letters + two to four digits + optional trailing letter
   * (e.g. POZ08A, WAW124, KRK05). Case-insensitive match; result is uppercased.
   */
  private static readonly PACZKOMAT_CODE_RE = /^[A-Z]{3}\d{2,4}[A-Z]?$/i;

  /**
   * Returns pickupPoint when the connection declares official_inpost module and
   * the delivery address carries a recognisable paczkomat code in address2.
   * Returns undefined in all other cases (wrong config, no address, no address2,
   * address2 not a locker code, fetch error).
   */
  private async resolvePickupPoint(
    order: PrestashopOrder,
    config: PrestashopConnectionConfig
  ): Promise<OrderPickupPoint | undefined> {
    if (config.inpostPsModuleType !== 'official_inpost') {
      return undefined;
    }
    const addressId = order.id_address_delivery;
    if (!addressId) {
      return undefined;
    }
    let address: PrestashopAddress;
    try {
      address = await this.httpClient.getResource<PrestashopAddress>(
        'addresses',
        String(addressId)
      );
    } catch (err) {
      this.logger.warn(
        `Failed to fetch delivery address ${String(addressId)} for paczkomat read on order ${String(order.id)}: ${(err as Error).message}`
      );
      return undefined;
    }
    const raw = address.address2;
    if (!raw || !PrestashopOrderSourceAdapter.PACZKOMAT_CODE_RE.test(raw)) {
      return undefined;
    }
    return { id: raw.toUpperCase() };
  }

  private readonly countryIso2Cache = new Map<string, string>();

  /**
   * Resolve a country's ISO-3166 alpha-2 code from its PrestaShop id_country,
   * cached per adapter instance. Returns '' on failure (callers default).
   */
  private async resolveCountryIso2(idCountry: string | number | undefined): Promise<string> {
    if (idCountry === undefined || idCountry === null) return '';
    const key = String(idCountry);
    const cached = this.countryIso2Cache.get(key);
    if (cached !== undefined) return cached;
    try {
      const country = await this.httpClient.getResource<{ iso_code?: string }>('countries', key);
      const iso = (country.iso_code ?? '').toUpperCase();
      this.countryIso2Cache.set(key, iso);
      return iso;
    } catch (error) {
      this.logger.warn(`Failed to resolve country ${key}: ${(error as Error).message}`);
      // Do not cache failures — a transient error must not suppress the country
      // for the lifetime of the adapter. The next order for the same country retries.
      return '';
    }
  }

  /**
   * Fetch a PrestaShop address resource by id and map it to the neutral
   * IncomingOrderAddress (incl. the B2B `company` field). Returns undefined
   * when the id is absent or the fetch fails.
   */
  private async hydrateAddress(
    addressId: string | number | undefined
  ): Promise<IncomingOrderAddress | undefined> {
    if (!addressId) return undefined;
    try {
      const a = await this.httpClient.getResource<PrestashopAddress & { company?: string }>(
        'addresses',
        String(addressId)
      );
      return {
        firstName: a.firstname,
        lastName: a.lastname,
        company: a.company,
        address1: a.address1 ?? '',
        address2: a.address2,
        city: a.city ?? '',
        postalCode: a.postcode ?? '',
        country: await this.resolveCountryIso2(a.id_country),
        phone: a.phone,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to hydrate address ${String(addressId)}: ${(error as Error).message}`
      );
      return undefined;
    }
  }

  private async fetchOrderRows(orderId: string | number): Promise<PrestashopOrderRow[]> {
    try {
      // PrestaShop 9.x renamed the `order_rows` webservice resource to
      // `order_details`; the row field shape (product_id/quantity/price/
      // reference) is unchanged, so the existing PrestashopOrderRow mapping
      // still applies.
      return await this.httpClient.listResources<PrestashopOrderRow>('order_details', {
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
