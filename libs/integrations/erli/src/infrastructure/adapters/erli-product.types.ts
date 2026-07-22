/**
 * Erli Product Resource Wire Types
 *
 * Request shapes for Erli's seller-keyed product resource
 * (`POST`/`PATCH /products/{externalId}`). Erli represents an offer AS a
 * product; #984 maps the basic fields the neutral offer commands carry.
 *
 * Verified against the live Erli Shop API (#992 spike): money is an INTEGER in
 * minor units (grosze, PLN-only — no currency field), `images` is an array of
 * image objects, the barcode key is `ean`, and `dispatchTime` is a required
 * create field. This file is the SINGLE wire-shape reconciliation point — the
 * adapter imports wire shapes only from here.
 *
 * The #985 taxonomy fields (`externalCategories` / `externalAttributes`, tagged
 * `source:"allegro"`, reusing OL's already-resolved Allegro ids — ADR-025 §3)
 * and the #986 variant-grouping shapes (`externalVariantGroup` + per-variant
 * `attributes`) are layered in here as the same single reconciliation point. The
 * adapter maps the neutral, core-populated `cmd.variantGroup` (#1065) onto these
 * wire shapes; no erli-named key lives in core.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 */
import type { ErliDispatchTime } from '../../domain/types/erli-connection.types';

/** Erli product image. `url` is required; the flags default false server-side. */
export interface ErliProductImage {
  url: string;
  isVariantImage?: boolean;
  isLifestyleImage?: boolean;
}

/**
 * Value-kind discriminator for an `externalAttribute` (#985). v1 maps Allegro
 * `valuesIds` → `dictionary` and free-text `values` → `string`; `number` is
 * reserved (single change point if #992 confirms Erli wants `integer`/`float`).
 */
export type ErliExternalAttributeType = 'dictionary' | 'string' | 'number';

/** One node of an Erli `externalCategories` breadcrumb path (`name` optional). */
export interface ErliCategoryBreadcrumbNode {
  id: string;
  name?: string;
}

/**
 * Category taxonomy reference. Erli's wire shape is `{ source, breadcrumb }`
 * (verified against the Shop API — `breadcrumb` is required, `additionalProperties:
 * false`, so a flat `{source, id}` is rejected). `source:"allegro"` reuses OL's
 * resolved Allegro id (#985); `source:"shop"` carries the master shop's own
 * category ids when no Allegro taxonomy was resolved (#1096 / ADR-025 §3).
 */
export interface ErliExternalCategory {
  source: 'allegro' | 'shop' | 'marketplace';
  breadcrumb: ErliCategoryBreadcrumbNode[];
}

/**
 * A single `dictionary`-type attribute value — Erli's Shop API rejects a bare
 * string/id here (`externalAttributes[N].values[M] must be of type object`,
 * confirmed live against the sandbox, #1384 follow-up); `name` is optional
 * (`additionalProperties: false`, only `id` is required per
 * `docs/architecture/adrs/erli-sandbox-swagger.json`).
 */
export interface ErliDictionaryAttributeValue {
  id: string | number;
  name?: string;
}

/**
 * Attribute entry in `externalAttributes`. `source:"allegro"` reuses an
 * OL-resolved Allegro parameter id (#985); `source:"shop"` carries a shop-native
 * attribute — used to express a variant's distinguishing axes for grouping
 * (#986), since Erli's `externalVariantGroup.attributes` references entries here
 * by `index` (verified against the Shop API). `index` defaults to the array
 * position; set explicitly when a grouping ref must point at a specific entry.
 *
 * `values`' element shape is keyed by `type` per the verified sandbox schema:
 * `string` → plain strings, `dictionary` → `{ id, name? }` objects. `number`/
 * `range` types exist in the schema but this adapter never emits them today.
 */
export interface ErliExternalAttribute {
  source: 'allegro' | 'shop';
  id: string;
  name?: string;
  type: ErliExternalAttributeType;
  values: string[] | ErliDictionaryAttributeValue[];
  index?: number;
  unit?: string;
}

/**
 * Multi-variant grouping reference (#986). Erli's verified wire shape is
 * `{ id, source, attributes }` where `attributes` are **integer indexes** into
 * the product's `externalAttributes` array (for `source:"integration"`) — the
 * distinguishing axes that vary across siblings. `id` is the parent/base OL
 * product id shared by every sibling; Erli renders the siblings as ONE
 * buyer-facing listing. Single/simple products (or siblings with no
 * distinguishing axes) omit it and list ungrouped. `attributes` is required and
 * `minItems: 1`, so a group is only emitted when ≥1 axis exists.
 */
export interface ErliVariantGroupRef {
  id: string;
  source: 'integration' | 'marketplace';
  attributes: number[];
}

/**
 * Create-product body — `POST /products/{externalId}`. Erli requires
 * `name, images, price, stock, dispatchTime` on create; the optional keys are
 * supplied when the neutral command carries them.
 */
export interface ErliProductCreateBody {
  name?: string;
  /** Price in INTEGER minor units (grosze). PLN-only — no currency field. */
  price?: number;
  stock?: number;
  description?: string;
  images?: ErliProductImage[];
  /** EAN/GTIN barcode. */
  ean?: string;
  sku?: string;
  dispatchTime?: ErliDispatchTime;
  /**
   * Responsible producer ("producent") the product references (#1531). Erli
   * keys it by the numeric responsible-producer dictionary id
   * (`GET /dictionaries/responsibleProducers`); without it the created product
   * is blocked for a missing producer. Supplied when the neutral command carries
   * an operator selection (`overrides.platformParams.producer`); omitted
   * otherwise. Erli's schema documents `producerId` as deprecated in favour of
   * the `externalResponsibleProducer` `{ externalId, source }` array, but the
   * numeric id maps 1:1 to a dictionary entry (which the picker reads), so it is
   * the direct and reliable reference here.
   */
  producerId?: number;
  /**
   * Delivery price list ("cennik dostawy") the offer references (#1530). Erli
   * keys a price list by its unique `name` string (the default list is named
   * `"*"`); without it the created offer lands not-buyable ("brak metody
   * dostawy"). Supplied when the neutral command carries an operator selection
   * (`overrides.platformParams.deliveryPriceList`); omitted otherwise.
   */
  deliveryPriceList?: string;
  /** Allegro category reuse (#985); omitted when empty. */
  externalCategories?: ErliExternalCategory[];
  /** Allegro parameter reuse (#985); omitted when empty. */
  externalAttributes?: ErliExternalAttribute[];
  /**
   * Multi-variant grouping (#986); omitted for single/simple products (and
   * siblings with no distinguishing axes) so they list ungrouped. Present ⇒ this
   * product is one sibling of a grouped listing. Its `attributes` index into
   * `externalAttributes` — there is NO top-level `attributes` field (the API
   * rejects one).
   */
  externalVariantGroup?: ErliVariantGroupRef;
}

/**
 * Sparse patch body — `PATCH /products/{externalId}`. Narrowed to only the
 * fields the adapter currently mutates (`name` / `price` / `stock` /
 * `description`) so a create-only key (`images`, `ean`, `sku`, `dispatchTime`)
 * cannot be hand-built into a patch. Every field is optional; the adapter emits
 * only supplied keys so Erli touches only those fields (the precondition #988
 * frozen-field exclusion builds on — widen this `Pick` when #988 patches more).
 */
export type ErliProductPatchBody = Pick<
  ErliProductCreateBody,
  'name' | 'price' | 'stock' | 'description'
>;

/**
 * Read-side product resource — `GET /products/{externalId}` (#988 / #992). The
 * field #988 needs is {@link ErliProductResource.frozen}: Erli marks seller-panel
 * manual edits `frozen` (ADR-025 §4b, per-nested-field granularity), and OL must
 * NOT overwrite a frozen field on a subsequent PATCH.
 *
 * The live shape (verified against the sandbox and
 * `docs/architecture/adrs/erli-sandbox-swagger.json`, #1737) is a `frozen` OBJECT
 * keyed by Erli field name with boolean values, e.g.
 * `{ "name": false, "price": true, "stock": false, ... }`. A field is frozen iff
 * `frozen[<erliName>] === true`. {@link ErliOfferManagerAdapter.fetchErliProduct}'s
 * consumers ({@link PATCH_KEY_TO_ERLI_FROZEN_NAME}, `ERLI_FROZEN_STOCK_FIELD`)
 * are the single change point for the OL-key → Erli-name mapping. #989 reuses this
 * same read path for offer-status reconciliation.
 */
/**
 * Erli-side publication status of a product/offer (read side, #989).
 * PROVISIONAL (#992): exact value set unconfirmed; the adapter maps it to the
 * neutral closed `OfferPublicationStatus` union.
 */
export type ErliProductStatus = 'accepted' | 'active' | 'inactive' | 'rejected';

/**
 * One item from `GET /dictionaries/responsibleProducers` (#1531). Erli returns
 * the `ResponsibleSchema` shape (`{ id: integer, name: string, ... }`); only the
 * `id` (referenced by the create body's `producerId`) and `name` (picker label)
 * are consumed. Verified against `docs/architecture/adrs/erli-sandbox-swagger.json`
 * (`ResponsibleSchema`, "pobierz listę producentów produktu").
 */
export interface ErliResponsibleProducerItem {
  id: number;
  name: string;
}

/**
 * One item from `GET /delivery/priceLists` (#1530). Erli returns
 * `{ id: integer, name: string }`; `name` is the unique delivery-method name
 * (the default list is `"*"`) that the create body's `deliveryPriceList` field
 * references. Verified against `docs/architecture/adrs/erli-sandbox-swagger.json`
 * (`PriceListListItem`).
 */
export interface ErliDeliveryPriceListItem {
  id: number;
  name: string;
}

/**
 * One category-breadcrumb node on the read-side product resource. Erli returns
 * `categories` as an array of breadcrumb paths (`[[{ id, name }, ...]]`); the
 * leaf of the first path is the most-specific category the offer sits under.
 * `id` is a numeric marketplace category id; `name` is the human-readable label.
 */
export interface ErliProductCategoryNode {
  id: number;
  name?: string;
}

export interface ErliProductResource {
  /**
   * Per-field frozen markers the seller has set via manual panel edits (#988):
   * a `Record<erliFieldName, boolean>` where `true` means frozen. Verified live
   * shape (#1737) — the API returns an object, e.g.
   * `{ name: false, price: true, stock: false, ... }`, not a flat name list.
   * Includes `stock` (#1066): reconciliation reads `frozen.stock === true` to
   * populate the per-offer frozen-stock cache flag the hot quantity path honors.
   * Absent (`undefined`) means the read carried no frozen info (bodyless 2xx or
   * the 404 fail-open branch) — treated as "unknown", never "nothing frozen".
   */
  frozen?: Record<string, boolean>;
  /** Current Erli-side publication status (#989). */
  status?: ErliProductStatus;
  /** Rejection / inactivation detail Erli supplies, when present (#989). */
  statusReason?: string;

  // ── Read-side offer-detail fields (OfferReader.getOffer) ──
  // Verified live against the sandbox GET /products/{externalId}: money is an
  // INTEGER in minor units (grosze, PLN-only), `images[].url` is a public URL,
  // and `categories` is an array of breadcrumb paths.
  /** Seller-keyed product id echoed back (the OL variant id used as the offer id). */
  externalId?: string;
  /** Offer title. */
  name?: string;
  /**
   * Rendered HTML description Erli returns alongside the structured
   * `description.sections` object. Preferred for the detail-page preview
   * because it is a flat string rather than a section tree.
   */
  externalDescription?: string;
  ean?: string;
  sku?: string;
  /** Price in INTEGER minor units (grosze). PLN-only — no currency field. */
  price?: number;
  stock?: number;
  images?: ErliProductImage[];
  /** Category breadcrumb paths; the first path's leaf is the offer's category. */
  categories?: ErliProductCategoryNode[][];
  /** Buyer-facing offer slug (e.g. `swieca-sojowa-200g`). */
  slug?: string;
  /** Numeric Erli marketplace offer id (distinct from the seller-keyed `externalId`). */
  marketplaceId?: number;
}
