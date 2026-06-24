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

/**
 * Category reuse tagged `source:"allegro"` (#985). Erli processes only the `id`
 * (the OL-resolved Allegro category id); names are ignored (ADR-025 §3).
 */
export interface ErliExternalCategory {
  source: 'allegro';
  id: string;
}

/**
 * Parameter reuse tagged `source:"allegro"` (#985). `id` is the OL-resolved
 * Allegro parameter id; `values` carries dictionary value-ids or free-text
 * scalars depending on `type`. `unit` is type-present but unwired in v1 — the
 * neutral command parameter entries don't carry unit metadata.
 */
export interface ErliExternalAttribute {
  source: 'allegro';
  id: string;
  type: ErliExternalAttributeType;
  values: string[];
  unit?: string;
}

/**
 * Multi-variant grouping reference (#986). `id` is the parent/base OL product id
 * shared by every sibling variant; Erli uses it to render the N sibling products
 * as ONE buyer-facing listing. Unlike Allegro (Product-Catalog auto-grouping off
 * GTIN), Erli grouping is explicit via this id. Single/simple products omit it.
 * PROVISIONAL (#992): the wire key + whether the group id is the parent product
 * id or a dedicated group key is unconfirmed until the sandbox spike.
 */
export interface ErliVariantGroupRef {
  id: string;
}

/**
 * A variant's distinguishing axis (#986), e.g. `{ name: 'Color', value: 'Red' }`.
 * Declared per-variant so Erli can present selectable options within the grouped
 * listing. Flattened from OL `ProductVariant.attributes` (`Record<string,string>`)
 * by the core populator (#1065, `OfferBuilderService`) into the neutral
 * `OfferVariantGroup.attributes`; the adapter maps that field-for-field here.
 */
export interface ErliVariantAttribute {
  name: string;
  value: string;
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
  /** Allegro category reuse (#985); omitted when empty. */
  externalCategories?: ErliExternalCategory[];
  /** Allegro parameter reuse (#985); omitted when empty. */
  externalAttributes?: ErliExternalAttribute[];
  /**
   * Multi-variant grouping (#986); omitted for single/simple products so they
   * list ungrouped. Present ⇒ this product is one sibling of a grouped listing.
   */
  externalVariantGroup?: ErliVariantGroupRef;
  /** Distinguishing axes within a grouped listing (#986); omitted when empty. */
  attributes?: ErliVariantAttribute[];
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
 * Provisional read-side product resource — `GET /products/{externalId}` (#988 /
 * #992). The single field #988 needs is {@link ErliProductResource.frozenFields}:
 * Erli marks seller-panel manual edits `frozen` (ADR-025 §4b, per-nested-field
 * granularity), and OL must NOT overwrite a frozen field on a subsequent PATCH.
 *
 * PROVISIONAL: the exact wire shape of the frozen marker is unconfirmed until
 * the #992 sandbox spike. Modelled here as a flat list of frozen Erli field
 * names (e.g. `["price","name","description","stock"]`) — the most plausible
 * shape and the simplest to evaluate per-field. If #992 reveals a different
 * shape (e.g. a per-field `{ value, frozen }` object), this type and
 * {@link ErliOfferManagerAdapter.fetchErliProduct}'s consumers are the single
 * change point. #989 reuses this same read path for offer-status reconciliation.
 */
/**
 * Erli-side publication status of a product/offer (read side, #989).
 * PROVISIONAL (#992): exact value set unconfirmed; the adapter maps it to the
 * neutral closed `OfferPublicationStatus` union.
 */
export type ErliProductStatus = 'accepted' | 'active' | 'inactive' | 'rejected';

export interface ErliProductResource {
  /**
   * Erli field names the seller has frozen via manual panel edits (#988). May
   * include `"stock"` (#1066): reconciliation reads it to populate the per-offer
   * frozen-stock cache flag the hot quantity path honors. No shape change — the
   * flat `string[]` already covers it (#992-provisional, same as the other names).
   */
  frozenFields?: string[];
  /** Current Erli-side publication status (#989). */
  status?: ErliProductStatus;
  /** Rejection / inactivation detail Erli supplies, when present (#989). */
  statusReason?: string;
}
