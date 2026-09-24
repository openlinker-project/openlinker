/**
 * Subiekt Bridge — orders wire types (OrderSource + OrderProcessorManager)
 *
 * Request/response shapes for the bridge's `/api/orders*` surface. Bridge-native
 * (Polish field names, ZK document numbering) — the neutral <-> bridge mapping
 * lives in `subiekt-order-source.adapter.ts` / `subiekt-order-processor.adapter.ts`,
 * NOT here. Mirrors the convention `subiekt-bridge.types.ts` established for
 * invoicing (#753).
 *
 * NOT YET LIVE-VERIFIED against the bridge (built in a sandboxed worktree with
 * no Windows access — see the adapter files' headers). Treat every field name
 * here as a first draft; a live wire-test may still reconcile it, exactly as
 * happened for the invoicing contract (see that file's own docblock).
 *
 * @module libs/integrations/subiekt/bridge
 */

/** One line on a customer order (ZK) being created. */
export interface BridgeOrderLine {
  /**
   * Subiekt towar/usługa symbol. Empty string for a one-off service line
   * with no catalogue match — e.g. the shipping line #3347 adds, mirroring
   * the empty-symbol convention `BridgeIssueInvoiceRequest`'s lines already
   * use for the identical case. The bridge maps an empty symbol onto
   * `DodajUslugeJednorazowa()` rather than `Pozycje.Dodaj(symbol)`.
   */
  symbol: string;
  ilosc: number;
  /** Buyer-paid gross total for this line (ADR-014 — never the catalogue price). */
  wartoscBrutto: number;
  /** Display name for a symbol-less service line — ignored when `symbol` is set. */
  nazwa?: string;
}

/** Inline buyer for order creation — same shape as `BridgeBuyer` in the invoicing contract. */
export interface BridgeOrderBuyer {
  nazwa: string;
  nip: string | null;
  telefon?: string;
  ulica?: string;
  kodPocztowy?: string;
  miejscowosc?: string;
  /**
   * ISO 3166-1 alpha-2 country of the buyer's address, resolved bridge-side
   * against `sl_Panstwo.pa_KodPanstwaISO` and written to the kontrahent's
   * `adr__Ewid.adr_IdPanstwo`.
   *
   * Omitted leaves the column NULL, which is what every kontrahent OpenLinker
   * created carried before this field existed - so an EU buyer looked
   * domestic to Subiekt and its own VAT classification had nothing to work
   * from. OpenLinker supplies the FACT and never the conclusion: whether a
   * sale is WDT is Subiekt's and the accountant's call, exactly as the
   * tax-rate chain leaves the rate to the product.
   *
   * An unrecognised code resolves to nothing and is ignored, never guessed
   * at: a wrong country is worse than an absent one.
   */
  countryCode?: string;
}

/** `POST /api/orders` request. */
export interface BridgeCreateOrderRequest {
  buyer: BridgeOrderBuyer;
  lines: BridgeOrderLine[];
  /**
   * OL's own order id — stamped onto `dok_NrPelnyOryg` (Trim30). #3369: the
   * bridge now checks this field for an existing ZK BEFORE creating one, so
   * this is the load-bearing idempotency key for `createOrder`, not merely
   * defense-in-depth — a retried call with the same `orderRef` returns the
   * ORIGINAL document rather than minting a second one.
   */
  orderRef: string;
  uwagi?: string;
  /**
   * ISO currency the line amounts are denominated in, written to the ZK's
   * `WalutaSymbol`. Omitted leaves the document on Subiekt's own default
   * currency — which is what every ZK carried before this field existed, so a
   * foreign-currency order was booked as though its figures were zlotys.
   */
  waluta?: string;
}

/** `POST /api/orders` response (`data`). */
export interface BridgeCreateOrderResponse {
  id: number;
  numer: string;
}

/** One row of the order feed (`GET /api/orders/feed`). */
export interface BridgeOrderFeedItem {
  id: number;
  numer: string;
  /** ISO timestamp — the watermark column's value for this row. */
  dataWystawienia: string;
}

/** `GET /api/orders/feed?since=...&limit=...` response (`data`). */
export interface BridgeOrderFeedResponse {
  items: BridgeOrderFeedItem[];
  /**
   * ISO timestamp watermark for the next page — the max `dataWystawienia` seen
   * in this page, or `null` when the page was empty (no cursor advancement).
   */
  nextCursor: string | null;
}

/** One line of a hydrated order (`GET /api/orders/{id}`). */
export interface BridgeOrderDetailLine {
  symbol: string;
  nazwa: string | null;
  ilosc: number;
  wartoscBrutto: number;
}

/** `GET /api/orders/{id}` response (`data`) — a single ZK, fully hydrated. */
export interface BridgeOrderDetailResponse {
  id: number;
  numer: string;
  dataWystawienia: string;
  kontrahentNazwa: string | null;
  kontrahentNip: string | null;
  kontrahentEmail: string | null;
  waluta: string;
  wartoscBrutto: number;
  lines: BridgeOrderDetailLine[];
}

/**
 * `PUT /api/orders/{id}/shipping` request — the `OrderFulfillmentUpdater`
 * write. Writes onto `Sfera.WriteShipping`, which stamps `d.Uwagi` (one-line
 * summary) and `d.UwagiExt` (full block) on the document — Subiekt exposes no
 * dedicated fulfillment-status field on a ZK, so the remarks fields are the
 * honest, always-present carrier for this.
 */
export interface BridgeWriteShippingRequest {
  carrier?: string;
  trackingNumber?: string;
  pickupPoint?: string;
  /** Free-text status label, e.g. "Wysłane" — not a Subiekt-native enum. */
  status?: string;
  trackingUrl?: string;
  shipmentRef?: string;
  orderRef?: string;
}

/** `PUT /api/orders/{id}/shipping` response (`data`). */
export interface BridgeWriteShippingResponse {
  numer: string;
}
