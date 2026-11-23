/**
 * Subiekt Order Source Adapter
 *
 * Implements `OrderSourcePort` over `SubiektOrdersBridgeClient`. Reads customer
 * orders (ZK — Zamówienie od Klienta) entered directly in Subiekt GT — e.g. by
 * an operator over the phone or at the counter — so they can be synchronised
 * out to another system. This is the read-only counterpart of
 * `SubiektOrderProcessorAdapter` (which writes orders INTO Subiekt).
 *
 * Not every Subiekt connection needs this capability; it is opt-in per the
 * connection's `enabledCapabilities`. It is genuinely optional MVP scope —
 * a connection that only issues invoices need not enable it.
 *
 * ## Cursor semantics
 *
 * The bridge has no event journal (unlike Allegro) and Subiekt GT's own
 * `SuDokumentyManager.Wybierz()` is a UI picker, not a headless query — so, like
 * every other read in this bridge, order listing goes through raw SQL on
 * `dok__Dokument`. The cursor is therefore a `dataWystawienia` (issue date)
 * watermark, exactly the PrestaShop `date_upd` shape this port's own docblock
 * documents. `null` input means "start from the beginning of the feed" - the
 * bridge applies no lookback of its own to a null `since`; `null` output means
 * the page was empty.
 *
 * ## Where order sync starts (#4228, #4265)
 *
 * Implements `OrderFeedBootstrap` and `OrderFeedDateBootstrap` (no
 * `OrderWindowReader`). `headCursor` reads the bridge's `GET /api/orders/feed/head`;
 * a bridge without that route answers 404 and the adapter walks the feed to its
 * end instead (bounded, then a typed refusal asking for a bridge upgrade). A date
 * is read as the ZK issue date.
 *
 * Live-verified against a real bridge on 2026-11-23 for the head, the date cursor
 * and the feed. Orders are ZK documents only.
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters
 */
import type { LoggerPort } from '@openlinker/shared/logging';
import type {
  OrderSourcePort,
  OrderFeedInput,
  OrderFeedOutput,
  IncomingOrder,
  OrderFeedBootstrap,
  OrderFeedDateBootstrap,
} from '@openlinker/core/orders';
import { OrderSyncStartUnavailableError } from '@openlinker/core/orders';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { SubiektOrdersBridgeClient } from '../../bridge/subiekt-orders-bridge.client';
import { findTowarVariantExternalId } from './subiekt-variant-identity';

const FALLBACK_WALK_PAGE_SIZE = 1000;
/** 200 pages of 1000 ZK. Past it the walk is not a fallback any more but an
 * hour-long read holding the poll lock, so it refuses instead. */
const FALLBACK_WALK_MAX_PAGES = 200;
/** A bare day or an ISO instant; only the calendar-day prefix is used, as on
 * PrestaShop, since the bridge keys its cursor on the day it stores. */
const ISO_DAY_PREFIX = /^(\d{4}-\d{2}-\d{2})(?:$|T)/;

export class SubiektOrderSourceAdapter
  implements OrderSourcePort, OrderFeedBootstrap, OrderFeedDateBootstrap
{
  constructor(
    private readonly bridge: SubiektOrdersBridgeClient,
    private readonly logger: LoggerPort,
    // #3365 - needed to tell a modelled towar from a standalone one. The
    // factory already holds this port and hands it to every other Subiekt
    // adapter; this was the only one it skipped.
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly connectionId: string,
  ) {}

  async headCursor(): Promise<string | null> {
    const head = await this.bridge.getOrderFeedHead();
    if (head !== null) {
      return head.nextCursor;
    }
    // 404: a bridge that predates GET /api/orders/feed/head. Walk the whole feed.
    this.logger.warn(
      'subiekt_order_feed_head_unavailable: bridge has no /api/orders/feed/head; ' +
        'walking the entire order feed to find its end (upgrade the bridge to avoid this)',
    );
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < FALLBACK_WALK_MAX_PAGES; pageNumber += 1) {
      const page = await this.bridge.listOrderFeed(cursor, FALLBACK_WALK_PAGE_SIZE);
      if (page.items.length === 0 || page.nextCursor === null || page.nextCursor === cursor) {
        return cursor;
      }
      cursor = page.nextCursor;
    }
    throw new OrderSyncStartUnavailableError(
      'This Subiekt connection has too many orders to find the newest one with the installed ' +
        'bridge version. Upgrade the Subiekt bridge to the latest version and try again.',
    );
  }

  cursorForDate(date: string): Promise<string> {
    // A rejected promise, not a synchronous throw: core awaits this and treats a rejection as
    // "this start cannot be honoured".
    return Promise.resolve().then(() => {
      const day = ISO_DAY_PREFIX.exec(date)?.[1];
      const parsed = day === undefined ? null : new Date(`${day}T00:00:00Z`);
      if (
        day === undefined ||
        parsed === null ||
        Number.isNaN(parsed.getTime()) ||
        !parsed.toISOString().startsWith(day)
      ) {
        throw new OrderSyncStartUnavailableError(
          `Invalid start date "${date}": expected YYYY-MM-DD`,
        );
      }
      return `${day}T00:00:00.0000000|0`;
    });
  }

  async listOrderFeed(input: OrderFeedInput): Promise<OrderFeedOutput> {
    const since = input.fromCursor;
    const response = await this.bridge.listOrderFeed(since, input.limit);

    this.logger.log(
      `Subiekt order feed: ${response.items.length} item(s) since ${since ?? '(beginning)'}`,
    );

    return {
      items: response.items.map((item) => ({
        externalOrderId: String(item.id),
        // Subiekt GT has no per-row event kind — every row surfaces as
        // 'updated' (the safe, re-ingestable choice: `OrderIngestionService`
        // treats a repeat externalOrderId as a re-pull, never a duplicate
        // create). ZK creation and edits are indistinguishable from this read.
        eventType: 'updated',
        occurredAt: item.dataWystawienia,
        // Deterministic dedupe key: id + the watermark value observed for it.
        eventKey: `${item.id}:${item.dataWystawienia}`,
      })),
      nextCursor: response.nextCursor,
    };
  }

  /**
   * Which mapping kind a ZK line's towar symbol should be resolved through.
   *
   * ## Why this is not simply `Product`
   *
   * #3359 established that `line.symbol` is the towar symbol
   * `SubiektProductMasterAdapter` maps as `CORE_ENTITY_TYPE.Product` - which is
   * true for a STANDALONE towar and false for one the operator has grouped into
   * a model. A model is ONE OpenLinker product whose external id is
   * `model:{mdt_Id}`, and its members are mapped as VARIANTS. So a modelled
   * towar has no `Product` mapping under its own symbol, and never will.
   *
   * `OrderItemRefResolverService`'s `'product'` case looks up `Product`, then
   * falls back to `ShopProduct` (#3365) - which is a publish record and cannot
   * exist for a towar nobody published TO Subiekt. It then throws
   * `MissingOrderItemMappingError`, and the order sits `awaiting_mapping`
   * forever. Silently: an unmapped line is a normal, self-healing state, so
   * nothing about it reads as permanent.
   *
   * ## It looks up; it never mints
   *
   * `findTowarVariantExternalId` is deliberately the lookup-only twin of the
   * resolver the ProductMaster sync uses. Minting here would create a variant
   * id for a towar OpenLinker has never synced and point a real order line at a
   * product that does not exist.
   *
   * A miss falls through to `'product'` unchanged, so a standalone towar - and
   * an install that has not run the catalogue sweep yet - behaves exactly as it
   * did before.
   */
  private async resolveProductRef(
    symbol: string,
  ): Promise<{ type: 'product' | 'variant'; externalId: string }> {
    try {
      const variantExternalId = await findTowarVariantExternalId(
        this.identifierMapping,
        this.connectionId,
        symbol,
      );
      if (variantExternalId !== null) {
        return { type: 'variant', externalId: variantExternalId };
      }
    } catch (error) {
      // A mapping read that fails must not fail the whole order hydration: the
      // fallback is exactly the pre-#3365 behaviour, which is right for every
      // standalone towar and no worse than before for a modelled one.
      this.logger.warn(
        `subiekt_order_variant_lookup_failed: could not check whether ${symbol} is a model member; falling back to a product reference. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return { type: 'product', externalId: symbol };
  }

  async getOrder(input: { externalOrderId: string }): Promise<IncomingOrder> {
    const detail = await this.bridge.getOrder(input.externalOrderId);

    const now = new Date().toISOString();
    return {
      externalOrderId: String(detail.id),
      orderNumber: detail.numer,
      status: 'pending',
      customerEmail: detail.kontrahentEmail ?? undefined,
      items: await Promise.all(
        detail.lines.map(async (line, index) => ({
          id: `${detail.id}-${index}`,
          productRef: await this.resolveProductRef(line.symbol),
          quantity: line.ilosc,
          price: line.ilosc > 0 ? line.wartoscBrutto / line.ilosc : line.wartoscBrutto,
          sku: line.symbol,
          name: line.nazwa ?? undefined,
        })),
      ),
      totals: {
        subtotal: detail.wartoscBrutto,
        tax: 0,
        shipping: 0,
        total: detail.wartoscBrutto,
        currency: detail.waluta,
        // ZK line amounts are gross, matching the ADR-014 buyer-paid
        // convention `Sfera.CreateZk` already writes with.
        taxTreatment: 'inclusive',
      },
      billingAddress:
        detail.kontrahentNazwa !== null
          ? {
              company: detail.kontrahentNazwa,
              taxId: detail.kontrahentNip,
              // Subiekt GT's kontrahent read carries no structured street/city
              // split in this MVP slice — address1/city/postalCode are
              // required by `IncomingOrderAddress` but not sourced yet.
              address1: '',
              city: '',
              postalCode: '',
              country: 'PL',
            }
          : undefined,
      placedAt: detail.dataWystawienia,
      createdAt: now,
      updatedAt: now,
    };
  }
}
