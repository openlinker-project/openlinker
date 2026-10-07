/**
 * Shoper Product Write Types (#3712)
 *
 * The body of `POST /products` / `PUT /products/:id` as far as the publisher
 * writes it. Verified live (2026-10-07) against a trial shop: a create needs
 * `translations.<lang>.name`, `category_id` and `stock.price`; an update accepts
 * any subset. `translations.<lang>.active` is the visibility (`0` draft, and `0`
 * is also the default when omitted).
 *
 * @module libs/integrations/shoper/src/domain/types
 */

export interface ShoperProductTranslationWrite {
  name?: string;
  description?: string;
  short_description?: string;
  seo_title?: string;
  seo_description?: string;
  seo_url?: string;
  /** `1` published, `0` draft. */
  active: 0 | 1;
}

export interface ShoperProductStockWrite {
  price?: number;
  stock?: number;
  code?: string;
  ean?: string;
  weight?: number;
}

export interface ShoperProductWriteBody {
  translations: Record<string, ShoperProductTranslationWrite>;
  /** Main category. REQUIRED by Shoper on create. */
  category_id?: number;
  /** Every category the product sits in, the main one included. */
  categories?: number[];
  stock?: ShoperProductStockWrite;
}
