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
 * adapter imports wire shapes only from here. Category/parameters (#985) and
 * variant grouping (#986) are layered in by their own issues.
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
}

/**
 * Provisional sparse patch body — `PATCH /products/{externalId}` (#992). Every
 * field is optional; the adapter emits only supplied keys so Erli touches only
 * those fields (the precondition #988 frozen-field exclusion builds on).
 */
export type ErliProductPatchBody = ErliProductCreateBody;
