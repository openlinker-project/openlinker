/**
 * PrestaShop webservice client (thin)
 *
 * A minimal read-only client over the PrestaShop Webservice API, used to assert
 * field/amount parity directly against the master shop (product name, SKU, EAN,
 * price, stock, order amounts) rather than trusting OL's projection alone.
 *
 * Auth is HTTP Basic with the webservice key as the username and an empty
 * password (`base64(key:)`). The key is a secret — it is NEVER returned by the
 * OL connection API, so it is supplied out-of-band (env `OL_PS_WEBSERVICE_KEY`).
 * Responses are requested as JSON (`output_format=JSON`); localized fields (name)
 * arrive as `[{ id, value }]` arrays and are flattened here.
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
