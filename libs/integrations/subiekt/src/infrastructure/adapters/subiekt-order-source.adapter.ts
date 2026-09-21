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
import type { SubiektOrdersBridgeClient } from '../../bridge/subiekt-orders-bridge.client';

export class SubiektOrderSourceAdapter implements OrderSourcePort {
  constructor(
    private readonly bridge: SubiektOrdersBridgeClient,
    private readonly logger: LoggerPort,
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

  async getOrder(input: { externalOrderId: string }): Promise<IncomingOrder> {
    const detail = await this.bridge.getOrder(input.externalOrderId);

    const now = new Date().toISOString();
    return {
      externalOrderId: String(detail.id),
      orderNumber: detail.numer,
      status: 'pending',
      customerEmail: detail.kontrahentEmail ?? undefined,
      items: detail.lines.map((line, index) => ({
        id: `${detail.id}-${index}`,
        productRef: { type: 'sku', externalId: line.symbol },
        quantity: line.ilosc,
        price: line.ilosc > 0 ? line.wartoscBrutto / line.ilosc : line.wartoscBrutto,
        sku: line.symbol,
        name: line.nazwa ?? undefined,
      })),
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
