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
  /**
   * Percent-as-string VAT rate (#3357, ADR-063), e.g. `'23'`, `'0'`, `'8.5'` —
   * `null` when the towar carries no VAT-rate assignment at all
   * (`tw_IdVatSp IS NULL`), genuinely different from a real 0% rate.
   */
  stawkaVat: string | null;
  /**
   * Bridge-served URLs of the towar's images (main image first), read from
   * Subiekt's own `tw_ZdjecieTw` blobs and addressed via the bridge's
   * `/gt-image/{towarId}` route. Absent or empty when the towar has none.
   *
   * OPTIONAL so a bridge predating the field keeps deserialising — its absence
   * simply means "no images", the behaviour every Subiekt product had before.
   */
  zdjecia?: string[] | null;
  /**
   * `tw__Towar.tw_IdGrupa` - the towar's group in Subiekt's single, FLAT
   * `sl_GrupaTw` list. `null` when the towar carries none.
   *
   * OPTIONAL so a bridge predating the field keeps deserialising; its absence
   * means "this bridge does not report a group", which the adapter reports as
   * no categories rather than as an empty group.
   */
  grupaId?: number | null;
  /** `sl_GrupaTw.grt_Nazwa` for {@link grupaId}, so a caller needs no second read. */
  grupaNazwa?: string | null;
  /**
   * `sl_ModelTw.mdt_Id` of the MODEL this towar belongs to, or `null`/absent
   * when the operator has not grouped it.
   *
   * A Subiekt model is the operator's own grouping of towary that are one
   * article in several sizes or finishes, and it is the only variant-shaped
   * fact Subiekt carries. It is emphatically NOT {@link grupaId}, which is a
   * flat assortment group: two towary file together there for accounting
   * reasons and are not variants of each other.
   *
   * A towar carrying this is a VARIANT, not a product — see
   * `SubiektProductMasterAdapter`, which keys such a product by its model.
   *
   * OPTIONAL so a bridge predating the field keeps deserialising; its absence
   * means "this bridge does not report models", which the adapter reads as
   * every towar being its own product - exactly the pre-model behaviour.
   */
  modelId?: number | null;
  /** `sl_ModelTw.mdt_Nazwa` for {@link modelId}, so a caller needs no second read. */
  modelNazwa?: string | null;
}

/**
 * One model plus the symbols of every live towar in it (`GET /api/models`).
 *
 * A model whose every member has been deleted does not appear at all: it
 * cannot be a product, and reporting it empty would invite a caller to create
 * one with no variants.
 */
export interface BridgeModelSummary {
  modelId: number;
  modelNazwa: string;
  symbole: string[];
}

/**
 * One model with every member hydrated (`GET /api/models/{id}`), ordered by
 * symbol so a caller that has to pick a representative member gets the same
 * one on every read.
 *
 * `pozycje` entries are byte-identical in shape to what
 * `GET /api/products/{symbol}` returns for the same towar - a caller must
 * never have to reconcile two shapes of one towar.
 */
export interface BridgeModel {
  modelId: number;
  modelNazwa: string;
  pozycje: BridgeProduct[];
}

/**
 * One Subiekt towar group (`sl_GrupaTw`).
 *
 * FLAT, not a tree: the table has exactly three columns (`grt_Id`,
 * `grt_Nazwa`, `grt_NrAnalityka`) and carries no parent reference, so a
 * Subiekt group has no depth and no ancestry to project. That is a property of
 * Subiekt GT, not a gap in this mapping.
 */
export interface BridgeCategory {
  id: number;
  nazwa: string;
}

/** `GET /api/products/categories` response (`data`). */
export interface BridgeListCategoriesResponse {
  categories: BridgeCategory[];
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

/** `GET /api/models` envelope payload. */
export interface BridgeListModelsResponse {
  models: BridgeModelSummary[];
}

export interface BridgeListProductSymbolsResponse {
  symbols: string[];
}

export interface BridgeSearchProductsResponse {
  products: BridgeProduct[];
}
