/**
 * PrestaShop Product-Publish Wire Types
 *
 * Request/response shapes for the PrestaShop WebService API `products`,
 * `categories`, and `stock_availables` resources, as used by
 * `PrestashopProductPublisherAdapter` (#1107). Integration-internal only —
 * CORE types are not modified.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/product-publisher
 */

/** Language-scoped text field, as required by the PrestaShop WebService multilingual API. */
export interface PrestashopLangField {
  language: Array<{ '@_id': string; '#text': string }>;
}

/**
 * Minimal request body for POST/PUT /api/products.
 *
 * A permissive index signature lets `platformParams` merge un-modeled fields
 * (e.g. `id_manufacturer`, `weight`) without widening the typed surface.
 * Explicit, modelled fields always win over any un-modeled key.
 */
export interface PrestashopProductWriteBody {
  id?: string | number;
  name: PrestashopLangField;
  description?: PrestashopLangField;
  link_rewrite: PrestashopLangField;
  /**
   * Stable, server-side idempotency key (= OL `internalVariantId`). Stamped on
   * every create so a retry can look the product up by `reference` and adopt the
   * orphan instead of creating a duplicate (#1107 create-idempotency guard).
   */
  reference?: string;
  /** Tax-excluded price; PS WS convention uses a decimal string. */
  price: string;
  active: '0' | '1';
  id_category_default: string;
  associations?: {
    categories?: { category: Array<{ id: string }> };
  };
  meta_title?: PrestashopLangField;
  meta_description?: PrestashopLangField;
  [key: string]: unknown;
}

/** Minimal product response from GET/POST/PUT /api/products. */
export interface PrestashopProductResponse {
  id: string | number;
  active: string | number;
}

/** Item from GET /api/products (list response, used for the reference lookup). */
export interface PrestashopProductListItem {
  id: string | number;
  reference?: string;
}

/** Category item from GET /api/categories (list response). */
export interface PrestashopCategoryListItem {
  id: string | number;
  name: string | PrestashopLangField;
  id_parent: string | number;
}

/** Response from POST /api/categories. */
export interface PrestashopCategoryResponse {
  id: string | number;
  name: string | PrestashopLangField;
  id_parent: string | number;
}

/** Item from GET /api/stock_availables (list response). */
export interface PrestashopStockAvailableItem {
  id: string | number;
  id_product: string | number;
  quantity: string | number;
}
