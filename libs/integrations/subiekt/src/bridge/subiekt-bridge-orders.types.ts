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
  /** Subiekt towar/usługa symbol. Empty for a one-off line with no catalogue match. */
  symbol: string;
  ilosc: number;
  /** Buyer-paid gross total for this line (ADR-014 — never the catalogue price). */
  wartoscBrutto: number;
}

/** Inline buyer for order creation — same shape as `BridgeBuyer` in the invoicing contract. */
export interface BridgeOrderBuyer {
  nazwa: string;
  nip: string | null;
  telefon?: string;
  ulica?: string;
  kodPocztowy?: string;
  miejscowosc?: string;
}

/** `POST /api/orders` request. */
export interface BridgeCreateOrderRequest {
  buyer: BridgeOrderBuyer;
  lines: BridgeOrderLine[];
  /** OL's own order id — stamped onto `dok_NrPelnyOryg` (Trim30), defense-in-depth only. */
  orderRef: string;
  uwagi?: string;
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
