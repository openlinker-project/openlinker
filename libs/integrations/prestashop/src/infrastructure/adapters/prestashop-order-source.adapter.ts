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
import { readSourceBuyerTaxId } from '@openlinker/core/orders';
import type { PrestashopConnectionConfig } from '../../domain/types/prestashop-config.types';
import type {
  PrestashopAddress,
  PrestashopCustomer,
} from '../provisioners/prestashop-provisioner.types';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import type {
  IPrestashopOrderMapper,
  PrestashopOrder,
  PrestashopOrderRow,
} from '../mappers/prestashop.mapper.interface';
import { PrestashopOrderStateCatalog } from '../provisioners/prestashop-order-state.catalog';
import type { PrestashopOrderStateSnapshot } from '../provisioners/prestashop-order-state.catalog';
import type { PrestashopOrderCurrencyResolver } from '../provisioners/prestashop-order-currency.resolver';
import {
  PrestashopApiException,
  PrestashopResourceNotFoundException,
} from '@openlinker/integrations-prestashop';
import { PrestashopTruncatedReadException } from '../../domain/exceptions/prestashop-truncated-read.exception';
import { readAllPrestashopPages } from '../http/prestashop-paged-read';
import type { PrestashopOrderFeedCursor } from '../../domain/types/prestashop-order-feed-cursor.types';
import {
  formatOrderFeedCursor,
  isAheadOf,
  isAlreadyConsumed,
  normalizeWallClock,
  parseOrderFeedCursor,
  shiftWallClockSeconds,
} from '../../domain/types/prestashop-order-feed-cursor.types';
import { Logger } from '@openlinker/shared/logging';

/**
 * PrestaShop Order Source Adapter
 *
 * Read-only adapter for fetching PrestaShop orders.
 *
 * Cursor format: a keyset over `(date_upd, id_order)`, serialized as
 * `YYYY-MM-DD HH:MM:SS|<id>` - see `prestashop-order-feed-cursor.types.ts` for
 * why the id is part of the read position and why the timestamp is never
 * interpreted. `null` input means "start from the beginning".
 */
export class PrestashopOrderSourceAdapter implements OrderSourcePort {
  private readonly logger = new Logger(PrestashopOrderSourceAdapter.name);

  /**
   * The shop's own order-state catalogue (#2607). Built here rather than
   * injected so the adapter's construction sites stay unchanged; it needs
   * nothing this adapter does not already hold.
   */
  private readonly orderStates: PrestashopOrderStateCatalog;

  constructor(
    private readonly httpClient: IPrestashopWebserviceClient,
    private readonly orderMapper: IPrestashopOrderMapper,
    private readonly connection: Connection,
    /**
     * Supplies `totals.currency`, which the mapper cannot (#2277) - resolving
     * an order's denomination is a WebService read and `mapOrder` is
     * synchronous by contract.
     */
    private readonly orderCurrencyResolver: PrestashopOrderCurrencyResolver
  ) {
    this.orderStates = new PrestashopOrderStateCatalog(httpClient, connection.id);
  }

  /**
   * Pages read in one poll before giving up on draining a single second.
   *
   * A poll normally reads one page. More than one is needed only when the whole
   * page was already consumed - which happens when more orders than the page
   * holds share one `date_upd` second. Bounded so a pathological shop costs a
   * fixed number of requests per poll rather than an unbounded scan.
   */
  private static readonly MAX_FEED_PAGES_PER_POLL = 20;

  async listOrderFeed(input: OrderFeedInput): Promise<OrderFeedOutput> {
    this.logger.debug(
      `Listing PrestaShop order feed (connection: ${this.connection.id}, fromCursor: ${input.fromCursor ?? 'none'}, limit: ${input.limit})`
    );

    const fromCursor = parseOrderFeedCursor(input.fromCursor);
    if (input.fromCursor && fromCursor === null) {
      // Reading from the beginning is the only safe answer to a cursor we cannot
      // parse. Starting from now would skip every order in between, silently.
      this.logger.warn(
        `Unreadable order-feed cursor "${input.fromCursor}" on connection ${this.connection.id}; ` +
          `restarting the feed from the beginning.`
      );
    }

    // Read before the first page, because every row's event type depends on
    // what its state MEANS. A failure here fails the poll rather than letting
    // a cancellation read as an ordinary update, which would resurrect the
    // order downstream (see `resolveFeedEventType`).
    const orderStates = await this.orderStates.load();

    const pageSize = input.limit > 0 ? input.limit : 1;
    const items: OrderFeedItem[] = [];
    let cursor: PrestashopOrderFeedCursor | null = fromCursor;
    let rowsRead = 0;

    for (let page = 0; page < PrestashopOrderSourceAdapter.MAX_FEED_PAGES_PER_POLL; page += 1) {
      const rows = await this.httpClient.listResources<PrestashopOrder>(
        'orders',
        {
          // Exclusive `>` is the only lower-bound operator the WebService has, so
          // the bound is moved back one second to keep the cursor's own second in
          // range. Everything already consumed in it is dropped by the keyset
          // below, so nothing is emitted twice within a poll.
          ...(fromCursor ? { updatedAfter: shiftWallClockSeconds(fromCursor.updatedAt, -1) } : {}),
          // Paging is only sound when the pages are ordered by the cursor's own
          // key. `id` breaks ties inside a second so the keyset has something to
          // resume from (#2605).
          sort: ['date_upd_ASC', 'id_ASC'],
        },
        pageSize,
        page * pageSize
      );

      rowsRead += rows.length;

      for (const row of rows) {
        const item = this.toFeedItem(row, orderStates);
        if (item === null) {
          continue;
        }
        if (fromCursor && isAlreadyConsumed(fromCursor, item.updatedAt, item.orderId)) {
          continue;
        }
        items.push(item.feedItem);
        const observed: PrestashopOrderFeedCursor = {
          updatedAt: item.updatedAt,
          lastOrderId: item.orderId,
        };
        // Rows arrive sorted, but the read position is still advanced by
        // comparison rather than by assignment: a shop that ignores the sort
        // must not be able to drag the watermark backwards.
        if (cursor === null || isAheadOf(observed, cursor)) {
          cursor = observed;
        }
      }

      // A short page ends the collection. A full page whose rows all turned out
      // to be already consumed means the poll has not made progress yet, so the
      // next offset is read within this same poll - otherwise a second holding
      // more orders than one page would return an empty feed for ever.
      if (rows.length < pageSize || items.length > 0) {
        break;
      }
    }

    if (
      items.length === 0 &&
      rowsRead >= pageSize * PrestashopOrderSourceAdapter.MAX_FEED_PAGES_PER_POLL
    ) {
      this.logger.warn(
        `PrestaShop order feed made no progress after ${rowsRead} row(s) on connection ` +
          `${this.connection.id}: more orders share one \`date_upd\` second than this poll can ` +
          `drain. Raise the poll limit; the read position is unchanged, so nothing is lost.`
      );
    }

    // The cursor is emitted even when every row was filtered out by
    // `eventTypes`, so a page of non-matching events cannot be re-read for ever.
    // It is never emitted BEHIND the input, so an empty page leaves the read
    // position exactly where it was rather than rewinding it.
    const nextCursor = cursor === null ? null : formatOrderFeedCursor(cursor);

    const filtered = input.eventTypes
      ? items.filter((i) => input.eventTypes!.includes(i.eventType))
      : items;

    this.logger.debug(
      `PrestaShop order feed read ${rowsRead} row(s), emitted ${filtered.length} item(s), ` +
        `nextCursor=${nextCursor ?? 'none'} (connection: ${this.connection.id})`
    );

    return { items: filtered, nextCursor: nextCursor ?? input.fromCursor ?? null };
  }

  /**
   * Project one order row onto a feed item plus its keyset coordinates.
   *
   * Returns `null` for a row that carries no usable `date_upd`. There is no
   * substitute for it: the worker's own clock would place the order at a
   * position the shop never wrote, moving the watermark past orders that were
   * really updated earlier.
   */
  private toFeedItem(
    order: PrestashopOrder,
    orderStates: PrestashopOrderStateSnapshot
  ): { feedItem: OrderFeedItem; updatedAt: string; orderId: number } | null {
    const externalOrderId = String(order.id);
    const orderId = Number.parseInt(externalOrderId, 10);
    const occurredAt = normalizeWallClock(order.date_upd);

    if (occurredAt === null || !Number.isFinite(orderId)) {
      this.logger.warn(
        `Skipping PrestaShop order ${externalOrderId} with unusable id/date_upd ` +
          `(connection: ${this.connection.id}); it will be re-read on the next poll.`
      );
      return null;
    }

    const createdAt = normalizeWallClock(order.date_add) ?? occurredAt;
    const eventType = this.resolveFeedEventType(order, createdAt, occurredAt, orderStates);

    return {
      updatedAt: occurredAt,
      orderId,
      feedItem: {
        externalOrderId,
        eventType,
        occurredAt,
        // PrestaShop has no event journal; a composite key gives us dedupe-safe ingestion.
        eventKey: `${externalOrderId}:${occurredAt}:${eventType}`,
      },
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
   * Cancellation is read from the shop's own state catalogue (#2607). This used
   * to key on the default-install id 6, so a shop that renumbered or added its
   * own states never emitted `cancelled` at all - and the order kept selling.
   * An unknown `current_state` is not a cancellation: it is a state this shop
   * does not have, and inferring cancellation from an id we cannot read would
   * cancel live orders.
   */
  private resolveFeedEventType(
    order: PrestashopOrder,
    createdAt: string,
    occurredAt: string,
    orderStates: PrestashopOrderStateSnapshot
  ): OrderFeedEventType {
    if (orderStates.statusOf(order.current_state) === 'cancelled') {
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

    // The mapper cannot answer this (#2607): what `current_state` means is a row
    // on the shop's own state table. An id this shop does not have reads
    // `pending`, which is what an order OpenLinker knows nothing about is - the
    // difference from the removed 1-7 table is that a custom shipped, paid or
    // cancelled state is no longer swept into it.
    const orderStates = await this.orderStates.load();
    const status = orderStates.statusOf(prestashopOrder.current_state) ?? 'pending';
    const config = this.connection.config as unknown as PrestashopConnectionConfig;

    // Resolved BEFORE the hydration reads below, and awaited rather than raced
    // alongside them, because this is the one step that can REFUSE the order
    // (#2277): a shop whose currency is unresolvable should cost one read, not
    // a full hydration, and a rejected promise held across those awaits would
    // be an unhandled rejection on every other failure path. The read is cached
    // per (connection, id_currency), so the added round-trip amortises away.
    const currency = await this.orderCurrencyResolver.resolveOrderCurrencyIso({
      connectionId: this.connection.id,
      client: this.httpClient,
      idCurrency: prestashopOrder.id_currency,
      orderRef: mapped.orderNumber || externalOrderId,
    });

    // Started before the pickup-point / address awaits so the extra customer
    // read overlaps them rather than lengthening the hydration chain (#1928).
    // `hydrateCustomerEmail` never rejects, so the pending promise is safe to
    // hold across the awaits below.
    const customerEmailPromise = this.hydrateCustomerEmail(prestashopOrder.id_customer);

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
      (await this.hydrateAddress(prestashopOrder.id_address_delivery)) ??
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
      status,
      customerExternalId:
        prestashopOrder.id_customer !== undefined ? String(prestashopOrder.id_customer) : undefined,
      customerEmail: await customerEmailPromise,
      items,
      totals: { ...mapped.totals, currency },
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
   * IncomingOrderAddress (incl. the B2B `company` field and the buyer tax id).
   * Returns undefined when the id is absent or the fetch fails.
   *
   * `vat_number` is PrestaShop's own buyer tax field on `ps_address` (#2599).
   * It is carried verbatim - no national format is applied, because the
   * invoicing domain is country-agnostic and the provider adapter owns the
   * regime. The three states matter: the resource not carrying the key at all
   * means the shop asserted nothing (an older PrestaShop, or a webservice role
   * without the field), while a returned blank means the buyer supplied none.
   * `readSourceBuyerTaxId` is what keeps every source agreeing on that.
   *
   * A failed fetch yields no address at all, which reads downstream as
   * unknown - correct, since a transport error says nothing about the buyer.
   */
  private async hydrateAddress(
    addressId: string | number | undefined
  ): Promise<IncomingOrderAddress | undefined> {
    if (!addressId) return undefined;
    try {
      const a = await this.httpClient.getResource<
        PrestashopAddress & { company?: string; vat_number?: string | null }
      >('addresses', String(addressId));
      return {
        firstName: a.firstname,
        lastName: a.lastname,
        company: a.company,
        taxId: readSourceBuyerTaxId(a.vat_number),
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

  /**
   * Fetch the buyer's e-mail from the PrestaShop `customers` resource (#1928).
   *
   * The `orders` resource carries only `id_customer`, so the e-mail needs its
   * own read — the same reason the outbound provisioner queries `customers`
   * separately. Without it `IncomingOrder.customerEmail` stays undefined for
   * every PrestaShop-sourced order, which both empties the order snapshot's
   * label recipient and makes `OrderIngestionService.resolveCustomerId` skip
   * customer-identity resolution entirely (no `customer_projections` row).
   *
   * Best-effort, mirroring `hydrateAddress`: a revoked `customers` WS
   * permission, a purged customer, or a transport error warns and yields
   * undefined rather than failing ingestion of an otherwise-valid order.
   */
  private async hydrateCustomerEmail(
    customerId: string | number | undefined
  ): Promise<string | undefined> {
    if (!customerId) return undefined;
    try {
      const customer = await this.httpClient.getResource<PrestashopCustomer>(
        'customers',
        String(customerId)
      );
      const email = customer.email?.trim();
      return email ? email : undefined;
    } catch (error) {
      this.logger.warn(
        `Failed to hydrate customer e-mail for customer ${String(customerId)}: ${(error as Error).message}`
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
      // Paged: a wholesale order runs past one page, and one page of lines is
      // indistinguishable from all of them (#2608).
      return await readAllPrestashopPages<PrestashopOrderRow>(
        (limit, offset) =>
          this.httpClient.listResources<PrestashopOrderRow>(
            'order_details',
            { custom: { id_order: orderId } },
            limit,
            offset
          ),
        {
          resource: 'order_details',
          connectionId: this.connection.id,
          detail: `id_order=${String(orderId)}`,
        }
      );
    } catch (error) {
      // A truncated read must not degrade into the empty-lines answer below: an
      // order with no lines mirrors as an order with nothing bought.
      if (error instanceof PrestashopTruncatedReadException) {
        throw error;
      }
      this.logger.warn(
        `Failed to fetch order rows for order ${orderId}: ${(error as Error).message}`
      );
      return [];
    }
  }
}
