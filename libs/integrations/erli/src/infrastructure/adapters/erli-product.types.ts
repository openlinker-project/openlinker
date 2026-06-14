/**
 * Erli Product Resource Wire Types
 *
 * Provisional request shapes for Erli's seller-keyed product resource
 * (`POST`/`PATCH /products/{externalId}`). Erli represents an offer AS a
 * product; #984 maps only the basic fields the neutral offer commands carry.
 *
 * PROVISIONAL (#992): the exact Erli field names + price/description shapes are
 * not confirmed until the sandbox spike. This file is the SINGLE reconciliation
 * point — the adapter imports wire shapes only from here, so #992 updates one
 * place. Category/parameters (#985) and variant grouping (#986) are
 * deliberately absent (their own issues).
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 */

/** Provisional Erli money shape (#992). */
export interface ErliMoney {
  amount: number;
  currency: string;
}

/** Provisional create-product body — `POST /products/{externalId}` (#992). */
export interface ErliProductCreateBody {
  /** Offer title (Erli wire key provisional — may be `title`; #992). */
  name?: string;
  price?: ErliMoney;
  stock?: number;
  description?: string;
  images?: string[];
  /** EAN/GTIN (top-level vs parameter-nested unconfirmed; #992 / #985). */
  barcode?: string;
}

/**
 * Provisional sparse patch body — `PATCH /products/{externalId}` (#992). Every
 * field is optional; the adapter emits only supplied keys so Erli touches only
 * those fields (the precondition #988 frozen-field exclusion builds on).
 */
export type ErliProductPatchBody = ErliProductCreateBody;
