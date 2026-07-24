/**
 * WooCommerce REST client (thin)
 *
 * A minimal client over the WooCommerce REST API (`/wp-json/wc/v3`), used to
 * assert field/amount parity directly against the WooCommerce store (product
 * name, SKU, price, category, attributes, stock) after OL publishes to it —
 * and, for the WooCommerce-parity suite (#1571), to seed WC-native state
 * (orders, order status transitions) that the suite needs as an independent
 * source of truth OL did not itself create, since there is no live-buyer
 * purchase in an unattended run.
 *
 * Auth is the WooCommerce consumer key/secret, passed as query params (the
 * over-HTTP variant WooCommerce supports for local/dev stacks). Both are secrets
 * — NEVER returned by the OL connection API — so they are supplied out-of-band
 * (env `OL_WC_CONSUMER_KEY` / `OL_WC_CONSUMER_SECRET`).
 *
 * @module api
 */

export interface WooCommerceCategoryView {
  id: number;
  name: string;
}

export interface WooCommerceAttributeView {
  name: string;
  options: string[];
}

export interface WooCommerceProductView {
  id: number;
  name: string | null;
  sku: string | null;
  price: string | null;
  regularPrice: string | null;
  stockQuantity: number | null;
  categories: WooCommerceCategoryView[];
  attributes: WooCommerceAttributeView[];
  /** GTIN/EAN read from `meta_data` (`_ean`/`ean`/`_gtin`/`gtin`/`_barcode`/`barcode`) — mirrors `WooCommerceProductMapper`. */
  ean: string | null;
  type: string | null;
}

/** A single WC product variation, as read back for per-variant parity (#1571 scenario 1/4). */
export interface WooCommerceVariationView {
  id: number;
  sku: string | null;
  price: string | null;
  stockQuantity: number | null;
  ean: string | null;
  attributes: Array<{ name: string; option: string }>;
}

export interface WooCommerceRestOptions {
  /** WordPress/WooCommerce site root URL, e.g. `http://localhost:8082`. */
  siteUrl: string;
  consumerKey: string;
  consumerSecret: string;
  requestTimeoutMs?: number;
}

/** A WC order line item, request or response shape (subset the suite reads/writes). */
export interface WooCommerceOrderLineInput {
  productId: number;
  variationId?: number;
  quantity: number;
}

export interface WooCommerceOrderLineView {
  productId: number;
  variationId: number | null;
  quantity: number;
  total: string | null;
}

export interface WooCommerceAddressInput {
  firstName: string;
  lastName: string;
  address1: string;
  city: string;
  postcode: string;
  country: string;
  email?: string;
}

/** Request body for `createOrder` — mirrors what an external checkout would post. */
export interface CreateWooCommerceOrderInput {
  status?: string;
  billing: WooCommerceAddressInput;
  shipping?: WooCommerceAddressInput;
  lineItems: WooCommerceOrderLineInput[];
}

export interface WooCommerceOrderView {
  id: number;
  status: string | null;
  total: string | null;
  currency: string | null;
  customerId: number | null;
  billingEmail: string | null;
  lineItems: WooCommerceOrderLineView[];
}

export interface WooCommerceCustomerView {
  id: number;
  email: string | null;
  billingAddress1: string | null;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class WooCommerceRestClient {
  private readonly baseUrl: string;

  private readonly consumerKey: string;

  private readonly consumerSecret: string;

  private readonly requestTimeoutMs: number;

  constructor(options: WooCommerceRestOptions) {
    this.baseUrl = `${options.siteUrl.replace(/\/$/, '')}/wp-json/wc/v3`;
    this.consumerKey = options.consumerKey;
    this.consumerSecret = options.consumerSecret;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getProduct(productId: number | string): Promise<WooCommerceProductView> {
    const body = await this.get(`/products/${productId}`);
    return this.toProductView(asRecord(body));
  }

  /** Find the first product matching an exact SKU, or null. */
  async getProductBySku(sku: string): Promise<WooCommerceProductView | null> {
    const body = await this.get(`/products?sku=${encodeURIComponent(sku)}`);
    const rows = asArray(body);
    if (rows.length === 0) return null;
    return this.toProductView(asRecord(rows[0]));
  }

  /**
   * Find a product by exact name via the WooCommerce `search` param, or null.
   * Needed because the OL WooCommerce publisher (MVP) does not set a SKU on the
   * created product, so name is the only reliable lookup key. Exact-match ONLY:
   * accepting the first fuzzy search hit would let downstream parity run
   * against the wrong product, so no match returns null and the caller fails
   * loudly instead.
   */
  async getProductByName(name: string): Promise<WooCommerceProductView | null> {
    const body = await this.get(`/products?search=${encodeURIComponent(name)}&per_page=100`);
    const rows = asArray(body).map((r) => this.toProductView(asRecord(r)));
    return rows.find((p) => p.name === name) ?? null;
  }

  /**
   * Create a native WC order directly against the store (test setup only) —
   * the WooCommerce-parity suite's substitute for a live buyer purchase, since
   * WC (unlike Allegro/Erli) exposes a writable order-creation endpoint the
   * suite can call unattended. Returns the created order's numeric id + status.
   */
  async createOrder(input: CreateWooCommerceOrderInput): Promise<WooCommerceOrderView> {
    const body = await this.post('/orders', {
      status: input.status ?? 'processing',
      billing: this.toWcAddress(input.billing),
      shipping: this.toWcAddress(input.shipping ?? input.billing),
      line_items: input.lineItems.map((line) => ({
        product_id: line.productId,
        ...(line.variationId !== undefined ? { variation_id: line.variationId } : {}),
        quantity: line.quantity,
      })),
    });
    return this.toOrderView(asRecord(body));
  }

  async getOrder(orderId: number | string): Promise<WooCommerceOrderView> {
    const body = await this.get(`/orders/${orderId}`);
    return this.toOrderView(asRecord(body));
  }

  /** Transition a WC order to a new status (e.g. `completed`) — test setup only. */
  async updateOrderStatus(orderId: number | string, status: string): Promise<WooCommerceOrderView> {
    const body = await this.put(`/orders/${orderId}`, { status });
    return this.toOrderView(asRecord(body));
  }

  /** Find a WC customer by exact email, or null. Used to assert customer-reuse (#1571 scenario 3). */
  async getCustomerByEmail(email: string): Promise<WooCommerceCustomerView | null> {
    const body = await this.get(`/customers?email=${encodeURIComponent(email)}`);
    const rows = asArray(body);
    if (rows.length === 0) return null;
    const record = asRecord(rows[0]);
    const billing = asRecord(pick(record, 'billing'));
    return {
      id: Number(pick(record, 'id') ?? 0),
      email: asStringOrNull(pick(record, 'email')),
      billingAddress1: asStringOrNull(pick(billing, 'address_1')),
    };
  }

  private toWcAddress(address: WooCommerceAddressInput): Record<string, unknown> {
    return {
      first_name: address.firstName,
      last_name: address.lastName,
      address_1: address.address1,
      city: address.city,
      postcode: address.postcode,
      country: address.country,
      ...(address.email ? { email: address.email } : {}),
    };
  }

  private toOrderView(record: Record<string, unknown>): WooCommerceOrderView {
    const billing = asRecord(pick(record, 'billing'));
    return {
      id: Number(pick(record, 'id') ?? 0),
      status: asStringOrNull(pick(record, 'status')),
      total: asStringOrNull(pick(record, 'total')),
      currency: asStringOrNull(pick(record, 'currency')),
      customerId: asNumberOrNull(pick(record, 'customer_id')),
      billingEmail: asStringOrNull(pick(billing, 'email')),
      lineItems: asArray(pick(record, 'line_items')).map((row) => {
        const line = asRecord(row);
        return {
          productId: Number(pick(line, 'product_id') ?? 0),
          variationId: asNumberOrNull(pick(line, 'variation_id')),
          quantity: Number(pick(line, 'quantity') ?? 0),
          total: asStringOrNull(pick(line, 'total')),
        };
      }),
    };
  }

  /** Find the first product variation with an active (`type: 'variable'`) parent by product id. */
  async getProductVariations(productId: number | string): Promise<WooCommerceVariationView[]> {
    const body = await this.get(`/products/${productId}/variations?per_page=100`);
    return asArray(body).map((row) => this.toVariationView(asRecord(row)));
  }

  private toProductView(record: Record<string, unknown>): WooCommerceProductView {
    return {
      id: Number(pick(record, 'id') ?? 0),
      name: asStringOrNull(pick(record, 'name')),
      sku: asStringOrNull(pick(record, 'sku')),
      price: asStringOrNull(pick(record, 'price')),
      regularPrice: asStringOrNull(pick(record, 'regular_price')),
      stockQuantity: asNumberOrNull(pick(record, 'stock_quantity')),
      type: asStringOrNull(pick(record, 'type')),
      ean: this.extractEan(pick(record, 'meta_data')),
      categories: asArray(pick(record, 'categories')).map((c) => {
        const cat = asRecord(c);
        return { id: Number(pick(cat, 'id') ?? 0), name: String(pick(cat, 'name') ?? '') };
      }),
      attributes: asArray(pick(record, 'attributes')).map((a) => {
        const attr = asRecord(a);
        return {
          name: String(pick(attr, 'name') ?? ''),
          options: asArray(pick(attr, 'options')).map((o) => String(o)),
        };
      }),
    };
  }

  private toVariationView(record: Record<string, unknown>): WooCommerceVariationView {
    return {
      id: Number(pick(record, 'id') ?? 0),
      sku: asStringOrNull(pick(record, 'sku')),
      price: asStringOrNull(pick(record, 'price')),
      stockQuantity: asNumberOrNull(pick(record, 'stock_quantity')),
      ean: this.extractEan(pick(record, 'meta_data')),
      attributes: asArray(pick(record, 'attributes')).map((a) => {
        const attr = asRecord(a);
        return { name: String(pick(attr, 'name') ?? ''), option: String(pick(attr, 'option') ?? '') };
      }),
    };
  }

  /** Mirrors `WooCommerceProductMapper`'s EAN_KEYS lookup over `meta_data`. */
  private extractEan(metaData: unknown): string | null {
    const keys = ['_ean', 'ean', '_gtin', 'gtin', '_barcode', 'barcode'];
    for (const entry of asArray(metaData)) {
      const meta = asRecord(entry);
      const key = String(pick(meta, 'key') ?? '');
      if (keys.includes(key)) {
        const value = pick(meta, 'value');
        if (value !== null && value !== undefined && String(value).length > 0) {
          return String(value);
        }
      }
    }
    return null;
  }

  private async get(path: string): Promise<unknown> {
    return this.request('GET', path);
  }

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', path, body);
  }

  private async put(path: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request('PUT', path, body);
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const separator = path.includes('?') ? '&' : '?';
    const auth = `consumer_key=${encodeURIComponent(this.consumerKey)}&consumer_secret=${encodeURIComponent(
      this.consumerSecret,
    )}`;
    const url = `${this.baseUrl}${path}${separator}${auth}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`WooCommerce ${method} ${path} → HTTP ${response.status}: ${raw.slice(0, 200)}`);
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`WooCommerce ${method} ${path} returned non-JSON: ${raw.slice(0, 200)}`);
    }
  }
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
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
