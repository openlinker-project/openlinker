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

/**
 * The body of `POST /product-images` (#3712 follow-up). Verified live: Shoper
 * fetches the image itself from `url` (the first image of a product becomes the
 * main one, the next ones get the next `order`); `content` (base64) is the
 * alternative. `name` is the alternative text.
 */
export interface ShoperImageWriteBody {
  product_id: number;
  url: string;
  name?: string;
}

/**
 * The body of `POST /categories` (#3713). Verified live: `parent_id` is
 * REQUIRED (`0` = a root) and Shoper accepts a duplicate name under one parent
 * and an unknown parent id without complaint, so both are the caller's to guard.
 */
export interface ShoperCategoryWriteBody {
  parent_id: number;
  translations: Record<string, { name: string; active: 0 | 1 }>;
}
