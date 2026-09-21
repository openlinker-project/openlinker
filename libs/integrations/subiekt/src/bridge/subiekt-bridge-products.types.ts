/**
 * Subiekt Bridge — ProductMaster wire types (Subiekt GT)
 *
 * Request/response shapes for the bridge's `/api/products*` surface. Bridge-
 * native (Polish field names, `symbol` as the external/master identifier —
 * `TowaryManager`'s own natural key, matching `tw__Towar.tw_Symbol`), the
 * neutral ⇄ bridge mapping lives in `SubiektProductMasterAdapter`, not here.
 *
 * TARGET WIRE CONTRACT — the Windows bridge side (`ProductsEndpoints.cs`) does
 * not exist yet at the time this file was written (no `powershell.exe` access
 * from this isolated worktree — see the adapter's own header). This is the
 * contract the Windows implementation MUST follow; the adapter below is built
 * and unit-tested against it, not verified live. Whoever builds
 * `ProductsEndpoints.cs` should treat this file as the spec, not guess a shape.
 *
 * Same envelope as the existing `/api/invoices*` surface: every response is
 * `{ success, data, error }` (see `subiekt-bridge.types.ts` `BridgeResponseEnvelope`
 * — reused by reference below, not duplicated). Same auth: `Authorization: Bearer
 * {InvoiceToken}` or `x-bridge-token` header, the existing `/api/*` middleware.
 *
 * Sfera GT facade behind these routes: `TowaryManager` (`DodajTowar`/
 * `WczytajTowar`/`WczytajTowarWg`/`Istnieje`) for writes/point-reads, raw SQL on
 * `tw__Towar` for listing/search (mirrors the existing bank-accounts/cash-
 * registers read pattern in `Invoicing.cs` — SQL for reads, Sfera for writes).
 *
 * Routes:
 *   GET  /api/products?limit=&offset=        -> BridgeListProductSymbolsResponse
 *   GET  /api/products/search?q=&limit=       -> BridgeSearchProductsResponse
 *   GET  /api/products/{symbol}               -> BridgeProduct (404 envelope when absent)
 *   POST /api/products                        -> BridgeProduct (create; body BridgeCreateProductRequest)
 *   PUT  /api/products/{symbol}                -> BridgeProduct (update; body BridgeUpdateProductRequest)
 *
 * @module libs/integrations/subiekt/bridge
 */

/**
 * A product (towar) as the bridge reports it. `symbol` is the natural key —
 * Subiekt GT has no separate numeric product id exposed at the Sfera level the
 * way `dok_Id` is for documents; `TowaryManager` itself is symbol-keyed
 * (`WczytajTowar(symbol)`), so `symbol` IS the external id OL's
 * IdentifierMappingService maps against.
 */
export interface BridgeProduct {
  symbol: string;
  nazwa: string;
  /** Net unit sale price, when the bridge could resolve one. */
  cenaSprzedazyNetto: number | null;
  /** Gross unit sale price — ADR-014 posture: OL reads/writes GROSS by default. */
  cenaSprzedazyBrutto: number | null;
  /** ISO 4217-ish; Subiekt GT default install is PLN-only. */
  waluta: string | null;
  opis: string | null;
  /** EAN / barcode, when the towar carries one. */
  kodKreskowy: string | null;
  /** Unit of measure symbol (e.g. `szt.`). */
  jednostkaMiary: string | null;
  waga: number | null;
}

export interface BridgeCreateProductRequest {
  symbol: string;
  nazwa: string;
  cenaSprzedazyBrutto?: number;
  waluta?: string;
  opis?: string;
  kodKreskowy?: string;
  jednostkaMiary?: string;
  waga?: number;
}

/** Partial — only provided fields are written. */
export interface BridgeUpdateProductRequest {
  nazwa?: string;
  cenaSprzedazyBrutto?: number;
  waluta?: string;
  opis?: string;
  kodKreskowy?: string;
  waga?: number;
}

export interface BridgeListProductSymbolsResponse {
  symbols: string[];
}

export interface BridgeSearchProductsResponse {
  products: BridgeProduct[];
}
