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
 * are layered in here. Variant grouping (#986) is added by its own issue.
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
