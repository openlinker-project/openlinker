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
 * documents. `null` input means "start from the beginning" (the bridge's own
 * choice of lookback); `null` output means the page was empty.
 *
 * ## NOT LIVE-VERIFIED (built with no Windows access)
 *
 * This file was built in a sandboxed worktree with no access to the Windows
 * bridge machine — the wire contract (`subiekt-bridge-orders.types.ts`) is a
 * first draft, unit-tested against itself but never wire-tested against a real
 * `GET /api/orders/feed` / `GET /api/orders/{id}` response. Reconcile against
 * the actual bridge DTOs before shipping, the same way #753's invoicing
 * contract needed one round of reconciliation after its first live test.
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters
 */
import type { LoggerPort } from '@openlinker/shared/logging';
import type {
  OrderSourcePort,
  OrderFeedInput,
  OrderFeedOutput,
  IncomingOrder,
} from '@openlinker/core/orders';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { SubiektOrdersBridgeClient } from '../../bridge/subiekt-orders-bridge.client';
import { findTowarVariantExternalId } from './subiekt-variant-identity';

export class SubiektOrderSourceAdapter implements OrderSourcePort {
  constructor(
    private readonly bridge: SubiektOrdersBridgeClient,
    private readonly logger: LoggerPort,
    // #3365 - needed to tell a modelled towar from a standalone one. The
    // factory already holds this port and hands it to every other Subiekt
    // adapter; this was the only one it skipped.
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly connectionId: string,
  ) {}

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
