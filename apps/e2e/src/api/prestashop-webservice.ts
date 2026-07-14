/**
 * PrestaShop webservice client (thin)
 *
 * A minimal client over the PrestaShop Webservice API, used to assert field /
 * amount parity directly against the master shop (product name, SKU, EAN, price,
 * stock, order amounts) rather than trusting OL's projection alone.
 *
 * Mostly read-only. `createProduct` / `setStock` (E3) are the sole WRITE paths:
 * they provision a fresh master product so a run exercises the create-paths
 * everywhere (opt-in via `E2E_FRESH_PRODUCT`). The write half is a SIMPLE-product
 * scaffold (one variant, parent-level EAN) and needs live verification — see the
 * TODO on `createProduct` and docs/manual-testing/e2e-golden-path.md § Fresh product.
 *
 * Auth is HTTP Basic with the webservice key as the username and an empty
 * password (`base64(key:)`). The key is a secret — it is NEVER returned by the
 * OL connection API, so it is supplied out-of-band (env `OL_PS_WEBSERVICE_KEY`).
 * JSON responses are requested (`output_format=JSON`); localized fields (name)
 * arrive as `[{ id, value }]` arrays and are flattened here. Writes POST/PUT an
 * XML body (the format the webservice accepts) while still asking for JSON back.
 *
 * @module api
 */

export interface PrestashopProductView {
  id: string;
  name: string | null;
  reference: string | null;
  ean13: string | null;
  price: string | null;
  idCategoryDefault: string | null;
  quantity: number | null;
}

export interface PrestashopStockView {
  idProduct: string;
  idProductAttribute: string;
  quantity: number;
}

export interface PrestashopOrderRowView {
  productId: string | null;
  productAttributeId: string | null;
  productReference: string | null;
  productEan13: string | null;
  productQuantity: number | null;
  unitPriceTaxIncl: string | null;
}

export interface PrestashopOrderView {
  id: string;
  reference: string | null;
  totalPaid: string | null;
  totalPaidTaxIncl: string | null;
  totalShippingTaxIncl: string | null;
  currentState: string | null;
  /** Line rows from `associations.order_rows` (empty if PS omits them). */
  rows: PrestashopOrderRowView[];
}

export interface PrestashopWebserviceOptions {
  /** PrestaShop base URL (the tunnel), e.g. `https://xxxx.trycloudflare.com`. */
  baseUrl: string;
  /** Webservice API key (secret). */
  apiKey: string;
  requestTimeoutMs?: number;
}

/** Input for `createProduct` — a SIMPLE (single-variant) master product. */
export interface CreateProductInput {
  /** Product display name (localized under `languageId`). */
  name: string;
  /** Unique `reference` (== SKU) — use a per-run suffix for a fresh product. */
  reference: string;
  /** Parent-level EAN-13 (simple product; combinations are a TODO). */
  ean13: string;
  /** Net price, as a decimal string (PS applies the product's tax rules). */
  price: string;
  /** Starting stock quantity for the product's single stock_available row. */
  quantity: number;
  /** Default category id (`id_category_default`). Defaults to `2` (Home). */
  idCategoryDefault?: string;
  /** Language id for localized fields. Defaults to `1`. */
  languageId?: string;
}

/** The identifiers of a freshly-created product. */
export interface CreatedProductRef {
  id: string;
  reference: string;
}

/** Input for `createCategory` — a leaf category under an existing parent. */
export interface CreateCategoryInput {
  /** Category display name (localized under language id 1). */
  name: string;
  /** Parent category id. Defaults to `2` (Home). */
  parentId?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class PrestashopWebserviceClient {
  private readonly baseUrl: string;

  private readonly authHeader: string;

  private readonly requestTimeoutMs: number;

  constructor(options: PrestashopWebserviceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.authHeader = `Basic ${Buffer.from(`${options.apiKey}:`).toString('base64')}`;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getProduct(productId: string): Promise<PrestashopProductView> {
    const body = await this.get(`/api/products/${productId}`);
    const product = asRecord(pick(body, 'product'));
    return {
      id: String(pick(product, 'id') ?? productId),
      name: flattenLocalized(pick(product, 'name')),
      reference: asStringOrNull(pick(product, 'reference')),
      ean13: asStringOrNull(pick(product, 'ean13')),
      price: asStringOrNull(pick(product, 'price')),
      idCategoryDefault: asStringOrNull(pick(product, 'id_category_default')),
      quantity: asNumberOrNull(pick(product, 'quantity')),
    };
  }

  /**
   * EAN-13 of every combination of a product. For a multi-variant product
   * PrestaShop stores barcodes on the COMBINATIONS, not the parent product
   * (the parent's `ean13` is typically empty) — variant-level parity must
   * compare against this set.
   */
  async getCombinationEans(productId: string): Promise<string[]> {
    const body = await this.get(
      `/api/combinations?filter[id_product]=${productId}&display=full`,
    );
    return asArray(pick(body, 'combinations'))
      .map((row) => asStringOrNull(pick(asRecord(row), 'ean13')))
      .filter((ean): ean is string => !!ean && ean.trim().length > 0);
  }

  /**
   * Sum available quantity across a product's `stock_availables` rows.
   *
   * For a product with combinations PrestaShop keeps one row per combination
   * PLUS an `id_product_attribute=0` aggregate row holding their sum — summing
   * everything would double-count. When combination rows exist, only they are
   * summed; a simple product (single `id_product_attribute=0` row) uses it.
   */
  async getStockForProduct(productId: string): Promise<number> {
    const body = await this.get(
      `/api/stock_availables?filter[id_product]=${productId}&display=full`,
    );
    const rows = asArray(pick(body, 'stock_availables')).map((row) => {
      const record = asRecord(row);
      return {
        attributeId: asStringOrNull(pick(record, 'id_product_attribute')) ?? '0',
        quantity: asNumberOrNull(pick(record, 'quantity')) ?? 0,
      };
    });
    const combinationRows = rows.filter((row) => row.attributeId !== '0');
    const relevant = combinationRows.length > 0 ? combinationRows : rows;
    return relevant.reduce((total, row) => total + row.quantity, 0);
  }

  async getOrder(orderId: string): Promise<PrestashopOrderView> {
    const body = await this.get(`/api/orders/${orderId}`);
    const order = asRecord(pick(body, 'order'));
    const rows = asArray(pick(asRecord(pick(order, 'associations')), 'order_rows')).map((row) => {
      const record = asRecord(row);
      return {
        productId: asStringOrNull(pick(record, 'product_id')),
        productAttributeId: asStringOrNull(pick(record, 'product_attribute_id')),
        productReference: asStringOrNull(pick(record, 'product_reference')),
        productEan13: asStringOrNull(pick(record, 'product_ean13')),
        productQuantity: asNumberOrNull(pick(record, 'product_quantity')),
        unitPriceTaxIncl: asStringOrNull(pick(record, 'unit_price_tax_incl')),
      };
    });
    return {
      id: String(pick(order, 'id') ?? orderId),
      reference: asStringOrNull(pick(order, 'reference')),
      totalPaid: asStringOrNull(pick(order, 'total_paid')),
      totalPaidTaxIncl: asStringOrNull(pick(order, 'total_paid_tax_incl')),
      totalShippingTaxIncl: asStringOrNull(pick(order, 'total_shipping_tax_incl')),
      currentState: asStringOrNull(pick(order, 'current_state')),
      rows,
    };
  }

  /**
   * Look up an existing category id by exact name so provisioning can REUSE a
   * category across runs instead of creating a duplicate every time. Returns the
   * first match's id, or null when no category with that name exists.
   */
  async getCategoryIdByName(name: string): Promise<string | null> {
    const body = await this.get(
      `/api/categories?filter[name]=${encodeURIComponent(name)}&display=[id,name]`,
    );
    const categories = asArray(pick(body, 'categories'));
    if (categories.length === 0) return null;
    return asStringOrNull(pick(asRecord(categories[0]), 'id'));
  }

  /**
   * Create a real category under an existing parent (default `2` = Home).
   *
   * A fresh product needs a REAL (non-Home) source category: OL's
   * `getProductCategories` excludes Root/Home as pseudo-categories (#1502), so a
   * product landing in Home has no resolvable source category and the Allegro
   * bulk-wizard category picker is empty. PrestaShop requires, per active
   * language, both `name` and a URL-safe `link_rewrite`, plus `id_parent` and
   * `active`. Returns the new category id (parsed from the webservice response).
   */
  async createCategory(input: CreateCategoryInput): Promise<{ id: string }> {
    const languageId = '1';
    const parentId = input.parentId ?? '2';
    const linkRewrite = slugify(input.name) || 'e2e-category';
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<prestashop>',
      '  <category>',
      `    <id_parent>${escapeXml(parentId)}</id_parent>`,
      '    <active>1</active>',
      `    <name><language id="${escapeXml(languageId)}">${escapeXml(input.name)}</language></name>`,
      `    <link_rewrite><language id="${escapeXml(languageId)}">${escapeXml(linkRewrite)}</language></link_rewrite>`,
      '  </category>',
      '</prestashop>',
    ].join('\n');

    const body = await this.send('POST', '/api/categories', xml);
    const category = asRecord(pick(body, 'category'));
    const id = asStringOrNull(pick(category, 'id'));
    if (!id) {
      throw new Error(
        `PrestaShop createCategory returned no id: ${JSON.stringify(body).slice(0, 200)}`,
      );
    }
    return { id };
  }

  /**
   * Create a fresh SIMPLE master product (E3) and set its starting stock.
   *
   * Returns the created product's id + reference (== SKU) so the caller can pin
   * the run to it after `master.product.syncAll` imports it into OL.
   *
   * TODO (needs live verification + follow-up work):
   *   - MULTI-VARIANT: this creates a single-variant (simple) product with a
   *     parent-level EAN. Real multi-variant coverage needs `combinations` +
   *     per-combination `ean13` + per-combination `stock_availables`. Deferred.
   *   - TAX: `price` is the net price; the product inherits whatever tax rule the
   *     store assigns by default. A run that asserts a specific gross may need an
   *     explicit `id_tax_rules_group`.
   */
  async createProduct(input: CreateProductInput): Promise<CreatedProductRef> {
    const languageId = input.languageId ?? '1';
    const categoryId = input.idCategoryDefault ?? '2';
    const linkRewrite = slugify(input.reference) || 'e2e-product';
    // A category ASSOCIATION is required, not just `id_category_default`: OL's
    // `getProductCategories` resolves the source category from
    // `associations.categories`, and a product created with only the default set
    // comes back with `associations.categories = null` (so OL can't resolve a
    // source category and the Allegro bulk-wizard category picker is empty).
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<prestashop>',
      '  <product>',
      `    <price>${escapeXml(input.price)}</price>`,
      `    <id_category_default>${escapeXml(categoryId)}</id_category_default>`,
      '    <active>1</active>',
      '    <state>1</state>',
      '    <available_for_order>1</available_for_order>',
      '    <show_price>1</show_price>',
      `    <reference>${escapeXml(input.reference)}</reference>`,
      `    <ean13>${escapeXml(input.ean13)}</ean13>`,
      `    <name><language id="${escapeXml(languageId)}">${escapeXml(input.name)}</language></name>`,
      `    <link_rewrite><language id="${escapeXml(languageId)}">${escapeXml(linkRewrite)}</language></link_rewrite>`,
      '    <associations>',
      '      <categories>',
      `        <category><id>${escapeXml(categoryId)}</id></category>`,
      '      </categories>',
      '    </associations>',
      '  </product>',
      '</prestashop>',
    ].join('\n');

    const body = await this.send('POST', '/api/products', xml);
    const product = asRecord(pick(body, 'product'));
    const id = asStringOrNull(pick(product, 'id'));
    if (!id) {
      throw new Error(
        `PrestaShop createProduct returned no id: ${JSON.stringify(body).slice(0, 200)}`,
      );
    }
    await this.setStock(id, input.quantity);
    return { id, reference: input.reference };
  }

  /**
   * Upload an image to a product via the webservice image endpoint
   * (`POST /api/images/products/{id}`, multipart/form-data, file field `image`).
   *
   * A fresh product is created without any photo, but Allegro rejects a photo-less
   * offer ("Wymagane jest co najmniej 1 zdjęcie"). We synthesize valid PNGs (see
   * `generate-image.ts`) and attach them here BEFORE the master sync so OL imports
   * the product with its images and forwards their (tunnel-hosted) URLs to Allegro.
   *
   * Multipart is sent via the global `FormData`/`Blob` (undici) — `fetch` sets the
   * boundary itself, so we must NOT set `Content-Type` manually here.
   */
  async addProductImage(
    productId: string,
    image: { bytes: Buffer | Uint8Array; filename: string; contentType: string },
  ): Promise<void> {
    const url = `${this.baseUrl}/api/images/products/${productId}?output_format=JSON`;
    const form = new FormData();
    const view = new Uint8Array(
      image.bytes.buffer,
      image.bytes.byteOffset,
      image.bytes.byteLength,
    );
    form.append('image', new Blob([view], { type: image.contentType }), image.filename);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: this.authHeader, Accept: 'application/json' },
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(
        `PrestaShop webservice POST /api/images/products/${productId} → HTTP ${response.status}: ${raw.slice(0, 300)}`,
      );
    }
  }

  /**
   * Set the quantity on a simple product's auto-created `stock_available` row
   * (the `id_product_attribute=0` aggregate). PrestaShop creates the row on
   * product-create; this reads it back and PUTs the new quantity.
   */
  async setStock(productId: string, quantity: number): Promise<void> {
    const listing = await this.get(
      `/api/stock_availables?filter[id_product]=${productId}&display=full`,
    );
    const rows = asArray(pick(listing, 'stock_availables')).map(asRecord);
    const row =
      rows.find((r) => (asStringOrNull(pick(r, 'id_product_attribute')) ?? '0') === '0') ?? rows[0];
    const stockId = row ? asStringOrNull(pick(row, 'id')) : null;
    if (!row || !stockId) {
      throw new Error(`PrestaShop setStock: no stock_available row for product ${productId}`);
    }
    const idProductAttribute = asStringOrNull(pick(row, 'id_product_attribute')) ?? '0';
    const idShop = asStringOrNull(pick(row, 'id_shop')) ?? '1';
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<prestashop>',
      '  <stock_available>',
      `    <id>${escapeXml(stockId)}</id>`,
      `    <id_product>${escapeXml(productId)}</id_product>`,
      `    <id_product_attribute>${escapeXml(idProductAttribute)}</id_product_attribute>`,
      `    <id_shop>${escapeXml(idShop)}</id_shop>`,
      '    <depends_on_stock>0</depends_on_stock>',
      '    <out_of_stock>2</out_of_stock>',
      `    <quantity>${Math.trunc(quantity)}</quantity>`,
      '  </stock_available>',
      '</prestashop>',
    ].join('\n');
    await this.send('PUT', `/api/stock_availables/${stockId}`, xml);
  }

  private async get(path: string): Promise<unknown> {
    const separator = path.includes('?') ? '&' : '?';
    const url = `${this.baseUrl}${path}${separator}output_format=JSON`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: this.authHeader, Accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`PrestaShop webservice GET ${path} → HTTP ${response.status}: ${raw.slice(0, 200)}`);
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`PrestaShop webservice GET ${path} returned non-JSON: ${raw.slice(0, 200)}`);
    }
  }

  /** POST/PUT an XML body, requesting a JSON response. Used by the write paths. */
  private async send(method: 'POST' | 'PUT', path: string, xmlBody: string): Promise<unknown> {
    const separator = path.includes('?') ? '&' : '?';
    const url = `${this.baseUrl}${path}${separator}output_format=JSON`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
          'Content-Type': 'text/xml',
        },
        body: xmlBody,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(
        `PrestaShop webservice ${method} ${path} → HTTP ${response.status}: ${raw.slice(0, 300)}`,
      );
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(
        `PrestaShop webservice ${method} ${path} returned non-JSON: ${raw.slice(0, 200)}`,
      );
    }
  }
}

/** Minimal XML text escaping for the write-path payloads. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Lowercase, hyphenated slug for `link_rewrite`. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function pick(record: unknown, key: string): unknown {
  return asRecord(record)[key];
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** PrestaShop localized fields serialize as `[{ id, value }]` — take the first. */
function flattenLocalized(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) {
    const first = asRecord(value[0]);
    return asStringOrNull(pick(first, 'value'));
  }
  return null;
}
