/**
 * WooCommerce REST client (thin)
 *
 * A minimal read-only client over the WooCommerce REST API (`/wp-json/wc/v3`),
 * used to assert field/amount parity directly against the WooCommerce store
 * (product name, SKU, price, category, attributes, stock) after OL publishes to
 * it.
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
}

export interface WooCommerceRestOptions {
  /** WordPress/WooCommerce site root URL, e.g. `http://localhost:8082`. */
  siteUrl: string;
  consumerKey: string;
  consumerSecret: string;
  requestTimeoutMs?: number;
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

  private toProductView(record: Record<string, unknown>): WooCommerceProductView {
    return {
      id: Number(pick(record, 'id') ?? 0),
      name: asStringOrNull(pick(record, 'name')),
      sku: asStringOrNull(pick(record, 'sku')),
      price: asStringOrNull(pick(record, 'price')),
      regularPrice: asStringOrNull(pick(record, 'regular_price')),
      stockQuantity: asNumberOrNull(pick(record, 'stock_quantity')),
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

  private async get(path: string): Promise<unknown> {
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
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`WooCommerce GET ${path} → HTTP ${response.status}: ${raw.slice(0, 200)}`);
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`WooCommerce GET ${path} returned non-JSON: ${raw.slice(0, 200)}`);
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
