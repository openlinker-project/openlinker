/**
 * PrestaShop webservice client (thin)
 *
 * A minimal client over the PrestaShop Webservice API, used to assert field /
 * amount parity directly against the master shop (product name, SKU, EAN, price,
 * stock, order amounts) rather than trusting OL's projection alone.
 *
 * Mostly read-only. `createProduct` / `createCombination` / `setStock` (E3) are the
 * WRITE paths: they provision a fresh master product so a run exercises the
 * create-paths everywhere (opt-in via `E2E_FRESH_PRODUCT`). `createProduct` covers
 * both shapes — a SIMPLE product (one synthetic variant, parent-level EAN) and a
 * MULTI-VARIANT one (`combinations`: per-combination reference / EAN-13 / stock),
 * the latter because the offer-creation segments need a product whose variants are
 * not yet all listed. See docs/manual-testing/e2e-golden-path.md § Fresh product.
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

/** A single product combination (variant), as read from `/api/combinations`. */
export interface PrestashopCombinationView {
  id: string;
  ean13: string | null;
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

/** Input for `createProduct` — a SIMPLE product, or MULTI-VARIANT via `combinations`. */
export interface CreateProductInput {
  /** Product display name (localized under `languageId`). */
  name: string;
  /** Unique `reference` (== SKU) — use a per-run suffix for a fresh product. */
  reference: string;
  /** Parent-level EAN-13. For a product WITH combinations each variant carries its own. */
  ean13: string;
  /** Net price, as a decimal string (PS applies the product's tax rules). */
  price: string;
  /**
   * Starting stock quantity for the product's single `stock_available` row.
   * Ignored when `combinations` is supplied — PrestaShop then derives the
   * `id_product_attribute=0` row as the sum of the per-combination rows, so
   * writing it directly would fight the platform's own aggregation.
   */
  quantity: number;
  /** Default category id (`id_category_default`). Defaults to `2` (Home). */
  idCategoryDefault?: string;
  /** Language id for localized fields. Defaults to `1`. */
  languageId?: string;
  /**
   * Combinations (variants) to create after the product itself. Supplying two or
   * more makes this a real MULTI-VARIANT master product: OL's PrestaShop adapter
   * enumerates `/api/combinations` and emits one `ProductVariant` per row (falling
   * back to a single synthetic variant only when the product has none), so this is
   * the only way a provisioned product imports with >1 variant.
   */
  combinations?: CreateCombinationInput[];
}

/**
 * Input for one combination of `createProduct` (`id_product` is supplied by the
 * caller of `createCombination`, or by `createProduct` itself).
 */
export interface CreateCombinationInput {
  /** Combination-level `reference` (== the variant's SKU). Must be unique per run. */
  reference: string;
  /** Combination-level EAN-13 — the barcode OL maps onto this variant. */
  ean13: string;
  /** Starting stock for this combination's own `stock_available` row. */
  quantity: number;
  /**
   * `product_option_value` ids that distinguish this combination (resolve/create
   * them via `ensureAttributeValues`). PrestaShop rejects a combination with no
   * option value, and OL reads them to build the variant's `attributes`.
   */
  optionValueIds: string[];
  /** Price IMPACT (delta on the parent's price), decimal string. Defaults to `0`. */
  priceImpact?: string;
  /**
   * Whether this is the product's default combination. Exactly one combination per
   * product may carry it (`default_on` is under a unique index with `id_product`),
   * so `createProduct` sets it on the first entry only.
   */
  isDefault?: boolean;
}

/** The identifiers of a freshly-created combination. */
export interface CreatedCombinationRef {
  id: string;
  reference: string;
  ean13: string;
}

/** The identifiers of a freshly-created product. */
export interface CreatedProductRef {
  id: string;
  reference: string;
  /** One entry per created combination; empty for a simple product. */
  combinations: CreatedCombinationRef[];
}

/** Input for `createAttributeGroup` — a PrestaShop `product_option`. */
export interface CreateAttributeGroupInput {
  /** Group name (localized), e.g. `Size`. Also used as `public_name` when omitted. */
  name: string;
  publicName?: string;
  /** PrestaShop front-office widget: `select` | `radio` | `color`. Defaults to `select`. */
  groupType?: string;
}

/** Input for `createAttributeValue` — a PrestaShop `product_option_value`. */
export interface CreateAttributeValueInput {
  idAttributeGroup: string;
  /** Value name (localized), e.g. `M`. */
  name: string;
}

/** Resolved attribute axis: the group and one option-value id per requested name. */
export interface EnsuredAttributeValues {
  groupId: string;
  /** Option-value ids, positionally aligned with the requested names. */
  valueIds: string[];
}

/** Input for `createCategory` — a leaf category under an existing parent. */
export interface CreateCategoryInput {
  /** Category display name (localized under language id 1). */
  name: string;
  /** Parent category id. Defaults to `2` (Home). */
  parentId?: string;
}

/** Input for `createCustomer` — a minimal guest-capable customer record. */
export interface CreateCustomerInput {
  firstName: string;
  lastName: string;
  email: string;
  /** Cleartext password (PrestaShop hashes internally); 5-72 chars. */
  password: string;
  /** Default customer group id. Defaults to `3` (the stock "Customer" group). */
  idDefaultGroup?: string;
  languageId?: string;
}

/** Input for `createAddress` — a delivery/invoice address for a customer. */
export interface CreateAddressInput {
  idCustomer: string;
  alias: string;
  firstName: string;
  lastName: string;
  address1: string;
  city: string;
  postcode: string;
  /** PrestaShop country id (numeric). Resolve via `getCountryIdByIso`. */
  idCountry: string;
  phone?: string;
}

/** Input for `createOrder` — the minimal fields the webservice requires. */
export interface CreateOrderInput {
  idCustomer: string;
  idAddressDelivery: string;
  idAddressInvoice: string;
  idCart: string;
  /** Net (tax-excl) products subtotal. */
  totalProducts: string;
  /** Gross (tax-incl) products subtotal. */
  totalProductsWt: string;
  /** Net (tax-excl) order total, INCLUDING shipping. */
  totalPaidTaxExcl: string;
  /** Gross (tax-incl) order total, INCLUDING shipping — the buyer-paid amount. */
  totalPaidTaxIncl: string;
  /** Gross (tax-incl) shipping cost. */
  totalShippingTaxIncl: string;
  currencyId?: string;
  languageId?: string;
  carrierId?: string;
  /** PrestaShop order state id. Defaults to `2` ("Payment accepted", stock install). */
  currentState?: string;
  /** Line rows — one per order_detail. */
  rows: Array<{
    productId: string;
    /** Combination id, or `'0'` for a simple product. */
    productAttributeId?: string;
    quantity: number;
    /** Unit gross (tax-incl) price the buyer pays for one unit. */
    unitPriceTaxIncl: string;
    productReference?: string;
  }>;
}

/** Input for `createCart` — the cart an order references via `id_cart`. */
export interface CreateCartInput {
  idCustomer: string;
  idAddressDelivery: string;
  idAddressInvoice: string;
  idCurrency?: string;
  idLang?: string;
  idCarrier?: string;
  rows: Array<{ productId: string; productAttributeId?: string; quantity: number }>;
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
   * List a product's combinations (id + EAN-13), for the stale-variant-pruning
   * lifecycle spec (#1495 / #1574): it needs a real combination `id` to DELETE
   * (not just the EAN set `getCombinationEans` returns).
   */
  async listCombinations(productId: string): Promise<PrestashopCombinationView[]> {
    const body = await this.get(
      `/api/combinations?filter[id_product]=${productId}&display=full`,
    );
    return asArray(pick(body, 'combinations')).map((row) => {
      const record = asRecord(row);
      return {
        id: String(pick(record, 'id')),
        ean13: asStringOrNull(pick(record, 'ean13')),
      };
    });
  }

  /**
   * Delete a combination (DESTRUCTIVE, irreversible via this client). Used by
   * the stale-variant-pruning lifecycle spec to simulate a variant removed at
   * the master — PrestaShop's webservice has no "undo", so callers must gate
   * this behind an explicit opt-in (`E2E_ALLOW_DESTRUCTIVE_PRUNE`).
   */
  async deleteCombination(combinationId: string): Promise<void> {
    const url = `${this.baseUrl}/api/combinations/${combinationId}?output_format=JSON`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: this.authHeader, Accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      const raw = await response.text();
      throw new Error(
        `PrestaShop webservice DELETE /api/combinations/${combinationId} → HTTP ${response.status}: ${raw.slice(0, 300)}`,
      );
    }
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
   * Create a fresh master product (E3) and set its starting stock — SIMPLE by
   * default, MULTI-VARIANT when `input.combinations` is supplied.
   *
   * Returns the created product's id + reference (== SKU), plus one ref per
   * created combination, so the caller can pin the run to it after
   * `master.product.syncAll` imports it into OL.
   *
   * TODO (needs live verification + follow-up work):
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

    const requestedCombinations = input.combinations ?? [];
    if (requestedCombinations.length === 0) {
      await this.setStock(id, input.quantity);
      return { id, reference: input.reference, combinations: [] };
    }

    const combinations: CreatedCombinationRef[] = [];
    for (const [index, combination] of requestedCombinations.entries()) {
      const created = await this.createCombination(id, {
        ...combination,
        // Exactly one default per product (unique index on `id_product,default_on`).
        isDefault: combination.isDefault ?? index === 0,
      });
      await this.setCombinationStock(id, created.id, combination.quantity);
      combinations.push(created);
    }
    return { id, reference: input.reference, combinations };
  }

  /**
   * Resolve (reuse-or-create) an attribute axis: one `product_option` group plus
   * one `product_option_value` per requested value name.
   *
   * Attribute groups and values are STORE-GLOBAL in PrestaShop, so a fresh
   * product must not mint its own copies every run — that would litter the shop
   * with a duplicate `Size` group per run and make the back office unusable.
   * Both levels are looked up by exact (localized) name first and created only
   * when genuinely absent; a stock PrestaShop install already ships `Size` with
   * `S`/`M`/`L`/`XL`, so the common path performs no writes at all.
   */
  async ensureAttributeValues(
    groupName: string,
    valueNames: string[],
  ): Promise<EnsuredAttributeValues> {
    const groupId =
      (await this.getAttributeGroupIdByName(groupName)) ??
      (await this.createAttributeGroup({ name: groupName })).id;
    const valueIds: string[] = [];
    for (const name of valueNames) {
      const valueId =
        (await this.getAttributeValueIdByName(groupId, name)) ??
        (await this.createAttributeValue({ idAttributeGroup: groupId, name })).id;
      valueIds.push(valueId);
    }
    return { groupId, valueIds };
  }

  /** Look up an attribute group (`product_option`) id by exact localized name. */
  async getAttributeGroupIdByName(name: string): Promise<string | null> {
    const body = await this.get(
      `/api/product_options?filter[name]=${encodeURIComponent(name)}&display=[id,name]`,
    );
    const groups = asArray(pick(body, 'product_options'));
    if (groups.length === 0) return null;
    return asStringOrNull(pick(asRecord(groups[0]), 'id'));
  }

  /** Create an attribute group (`product_option`). */
  async createAttributeGroup(input: CreateAttributeGroupInput): Promise<{ id: string }> {
    const languageId = '1';
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<prestashop>',
      '  <product_option>',
      `    <group_type>${escapeXml(input.groupType ?? 'select')}</group_type>`,
      '    <is_color_group>0</is_color_group>',
      `    <name><language id="${escapeXml(languageId)}">${escapeXml(input.name)}</language></name>`,
      `    <public_name><language id="${escapeXml(languageId)}">${escapeXml(input.publicName ?? input.name)}</language></public_name>`,
      '  </product_option>',
      '</prestashop>',
    ].join('\n');
    const body = await this.send('POST', '/api/product_options', xml);
    const group = asRecord(pick(body, 'product_option'));
    const id = asStringOrNull(pick(group, 'id'));
    if (!id) {
      throw new Error(
        `PrestaShop createAttributeGroup returned no id: ${JSON.stringify(body).slice(0, 200)}`,
      );
    }
    return { id };
  }

  /** Look up an option value id by exact localized name WITHIN one attribute group. */
  async getAttributeValueIdByName(groupId: string, name: string): Promise<string | null> {
    const body = await this.get(
      `/api/product_option_values?filter[id_attribute_group]=${encodeURIComponent(groupId)}` +
        `&filter[name]=${encodeURIComponent(name)}&display=[id,name]`,
    );
    const values = asArray(pick(body, 'product_option_values'));
    if (values.length === 0) return null;
    return asStringOrNull(pick(asRecord(values[0]), 'id'));
  }

  /** Create an option value (`product_option_value`) inside an attribute group. */
  async createAttributeValue(input: CreateAttributeValueInput): Promise<{ id: string }> {
    const languageId = '1';
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<prestashop>',
      '  <product_option_value>',
      `    <id_attribute_group>${escapeXml(input.idAttributeGroup)}</id_attribute_group>`,
      `    <name><language id="${escapeXml(languageId)}">${escapeXml(input.name)}</language></name>`,
      '  </product_option_value>',
      '</prestashop>',
    ].join('\n');
    const body = await this.send('POST', '/api/product_option_values', xml);
    const value = asRecord(pick(body, 'product_option_value'));
    const id = asStringOrNull(pick(value, 'id'));
    if (!id) {
      throw new Error(
        `PrestaShop createAttributeValue returned no id: ${JSON.stringify(body).slice(0, 200)}`,
      );
    }
    return { id };
  }

  /**
   * Create one combination (variant) of an existing product.
   *
   * `minimal_quantity` is REQUIRED by the webservice schema, and `default_on` is
   * emitted only for the default combination — the column sits under a unique
   * index with `id_product`, so a second row carrying `0` (rather than SQL NULL)
   * would collide.
   */
  async createCombination(
    productId: string,
    input: CreateCombinationInput,
  ): Promise<CreatedCombinationRef> {
    const optionValues = input.optionValueIds
      .map(
        (valueId) =>
          `        <product_option_value><id>${escapeXml(valueId)}</id></product_option_value>`,
      )
      .join('\n');
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<prestashop>',
      '  <combination>',
      `    <id_product>${escapeXml(productId)}</id_product>`,
      `    <reference>${escapeXml(input.reference)}</reference>`,
      `    <ean13>${escapeXml(input.ean13)}</ean13>`,
      `    <price>${escapeXml(input.priceImpact ?? '0')}</price>`,
      '    <minimal_quantity>1</minimal_quantity>',
      input.isDefault ? '    <default_on>1</default_on>' : '',
      '    <associations>',
      '      <product_option_values>',
      optionValues,
      '      </product_option_values>',
      '    </associations>',
      '  </combination>',
      '</prestashop>',
    ]
      .filter((line) => line.length > 0)
      .join('\n');

    const body = await this.send('POST', '/api/combinations', xml);
    const combination = asRecord(pick(body, 'combination'));
    const id = asStringOrNull(pick(combination, 'id'));
    if (!id) {
      throw new Error(
        `PrestaShop createCombination returned no id: ${JSON.stringify(body).slice(0, 200)}`,
      );
    }
    return { id, reference: input.reference, ean13: input.ean13 };
  }

  /**
   * Resolve a PrestaShop country id by its ISO 3166-1 alpha-2 code (e.g. `PL`).
   * Used so address creation never hardcodes an id that varies by install.
   */
  async getCountryIdByIso(iso: string): Promise<string | null> {
    const body = await this.get(`/api/countries?filter[iso_code]=${encodeURIComponent(iso)}`);
    const countries = asArray(pick(body, 'countries'));
    if (countries.length === 0) return null;
    return asStringOrNull(pick(asRecord(countries[0]), 'id'));
  }

  /**
   * Resolve a currency id from its ISO 4217 code, mirroring
   * {@link getCountryIdByIso}.
   *
   * A shop carries only the currencies its operator activated, so a caller
   * that needs a SPECIFIC denomination has to ask rather than assume: `null`
   * means "this shop does not carry that currency", which a spec turns into a
   * precise skip instead of an order silently created in the shop default.
   */
  async getCurrencyIdByIso(iso: string): Promise<string | null> {
    const body = await this.get(`/api/currencies?filter[iso_code]=${encodeURIComponent(iso)}`);
    const currencies = asArray(pick(body, 'currencies'));
    if (currencies.length === 0) return null;
    return asStringOrNull(pick(asRecord(currencies[0]), 'id'));
  }

  /**
   * Create a minimal customer record via the webservice (order synthesis,
   * #1573 — no marketplace purchase; orders for the invoicing suite are
   * created directly against PrestaShop as a REST order source). Needs live
   * verification against a real webservice install (mirrors the same caveat
   * already documented on `createProduct`).
   */
  async createCustomer(input: CreateCustomerInput): Promise<{ id: string }> {
    const languageId = input.languageId ?? '1';
    const idDefaultGroup = input.idDefaultGroup ?? '3';
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<prestashop>',
      '  <customer>',
      `    <id_default_group>${escapeXml(idDefaultGroup)}</id_default_group>`,
      `    <id_lang>${escapeXml(languageId)}</id_lang>`,
      '    <active>1</active>',
      `    <lastname>${escapeXml(input.lastName)}</lastname>`,
      `    <firstname>${escapeXml(input.firstName)}</firstname>`,
      `    <email>${escapeXml(input.email)}</email>`,
      `    <passwd>${escapeXml(input.password)}</passwd>`,
      '  </customer>',
      '</prestashop>',
    ].join('\n');

    const body = await this.send('POST', '/api/customers', xml);
    const customer = asRecord(pick(body, 'customer'));
    const id = asStringOrNull(pick(customer, 'id'));
    if (!id) {
      throw new Error(
        `PrestaShop createCustomer returned no id: ${JSON.stringify(body).slice(0, 200)}`,
      );
    }
    return { id };
  }

  /** Create a delivery/invoice address for a customer (order synthesis, #1573). */
  async createAddress(input: CreateAddressInput): Promise<{ id: string }> {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<prestashop>',
      '  <address>',
      `    <id_customer>${escapeXml(input.idCustomer)}</id_customer>`,
      `    <alias>${escapeXml(input.alias)}</alias>`,
      `    <lastname>${escapeXml(input.lastName)}</lastname>`,
      `    <firstname>${escapeXml(input.firstName)}</firstname>`,
      `    <address1>${escapeXml(input.address1)}</address1>`,
      `    <city>${escapeXml(input.city)}</city>`,
      `    <postcode>${escapeXml(input.postcode)}</postcode>`,
      `    <id_country>${escapeXml(input.idCountry)}</id_country>`,
      input.phone ? `    <phone>${escapeXml(input.phone)}</phone>` : '',
      '  </address>',
      '</prestashop>',
    ]
      .filter((line) => line.length > 0)
      .join('\n');

    const body = await this.send('POST', '/api/addresses', xml);
    const address = asRecord(pick(body, 'address'));
    const id = asStringOrNull(pick(address, 'id'));
    if (!id) {
      throw new Error(
        `PrestaShop createAddress returned no id: ${JSON.stringify(body).slice(0, 200)}`,
      );
    }
    return { id };
  }

  /**
   * Create the cart an order references via `id_cart`. PrestaShop's order
   * webservice resource requires an existing cart id even though the order
   * body itself carries the authoritative line/total data (order synthesis,
   * #1573).
   */
  async createCart(input: CreateCartInput): Promise<{ id: string }> {
    const currencyId = input.idCurrency ?? '1';
    const languageId = input.idLang ?? '1';
    const carrierId = input.idCarrier ?? '1';
    const cartRows = input.rows
      .map(
        (row) =>
          '        <cart_row>' +
          `<id_product>${escapeXml(row.productId)}</id_product>` +
          `<id_product_attribute>${escapeXml(row.productAttributeId ?? '0')}</id_product_attribute>` +
          `<quantity>${Math.trunc(row.quantity)}</quantity>` +
          '</cart_row>',
      )
      .join('\n');
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<prestashop>',
      '  <cart>',
      `    <id_currency>${escapeXml(currencyId)}</id_currency>`,
      `    <id_lang>${escapeXml(languageId)}</id_lang>`,
      `    <id_customer>${escapeXml(input.idCustomer)}</id_customer>`,
      `    <id_address_delivery>${escapeXml(input.idAddressDelivery)}</id_address_delivery>`,
      `    <id_address_invoice>${escapeXml(input.idAddressInvoice)}</id_address_invoice>`,
      `    <id_carrier>${escapeXml(carrierId)}</id_carrier>`,
      '    <recyclable>0</recyclable>',
      '    <associations>',
      '      <cart_rows>',
      cartRows,
      '      </cart_rows>',
      '    </associations>',
      '  </cart>',
      '</prestashop>',
    ].join('\n');

    const body = await this.send('POST', '/api/carts', xml);
    const cart = asRecord(pick(body, 'cart'));
    const id = asStringOrNull(pick(cart, 'id'));
    if (!id) {
      throw new Error(`PrestaShop createCart returned no id: ${JSON.stringify(body).slice(0, 200)}`);
    }
    return { id };
  }

  /**
   * Create an order directly against the webservice (order synthesis, #1573 —
   * the invoicing E2E suite needs unattended orders with no marketplace
   * purchase; PrestaShop is already a supported `OrderSourcePort`, so a
   * webservice-created order is a real "REST source" the existing
   * `marketplace.orders.poll` job ingests via the `date_upd` watermark).
   *
   * Needs live verification: the exact set of REQUIRED webservice fields for
   * `POST /api/orders` is not otherwise exercised by this test-support client
   * (unlike `createProduct`/`createCategory`, which are exercised by the
   * golden path's fresh-product option) — see the caveat already documented on
   * `createProduct`.
   */
  async createOrder(input: CreateOrderInput): Promise<{ id: string }> {
    const currencyId = input.currencyId ?? '1';
    const languageId = input.languageId ?? '1';
    const carrierId = input.carrierId ?? '1';
    const currentState = input.currentState ?? '2';
    const orderRows = input.rows
      .map(
        (row, index) =>
          '        <order_row>' +
          `<id>${index + 1}</id>` +
          `<product_id>${escapeXml(row.productId)}</product_id>` +
          `<product_attribute_id>${escapeXml(row.productAttributeId ?? '0')}</product_attribute_id>` +
          `<product_quantity>${Math.trunc(row.quantity)}</product_quantity>` +
          `<product_price>${escapeXml(row.unitPriceTaxIncl)}</product_price>` +
          `<product_reference>${escapeXml(row.productReference ?? '')}</product_reference>` +
          '</order_row>',
      )
      .join('\n');
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<prestashop>',
      '  <order>',
      `    <id_customer>${escapeXml(input.idCustomer)}</id_customer>`,
      `    <id_address_delivery>${escapeXml(input.idAddressDelivery)}</id_address_delivery>`,
      `    <id_address_invoice>${escapeXml(input.idAddressInvoice)}</id_address_invoice>`,
      `    <id_cart>${escapeXml(input.idCart)}</id_cart>`,
      `    <id_currency>${escapeXml(currencyId)}</id_currency>`,
      `    <id_lang>${escapeXml(languageId)}</id_lang>`,
      `    <id_carrier>${escapeXml(carrierId)}</id_carrier>`,
      `    <current_state>${escapeXml(currentState)}</current_state>`,
      '    <module>ps_checkpayment</module>',
      '    <payment>Check payment</payment>',
      '    <valid>1</valid>',
      '    <conversion_rate>1.000000</conversion_rate>',
      `    <total_paid>${escapeXml(input.totalPaidTaxIncl)}</total_paid>`,
      `    <total_paid_tax_incl>${escapeXml(input.totalPaidTaxIncl)}</total_paid_tax_incl>`,
      `    <total_paid_tax_excl>${escapeXml(input.totalPaidTaxExcl)}</total_paid_tax_excl>`,
      `    <total_paid_real>${escapeXml(input.totalPaidTaxIncl)}</total_paid_real>`,
      `    <total_products>${escapeXml(input.totalProducts)}</total_products>`,
      `    <total_products_wt>${escapeXml(input.totalProductsWt)}</total_products_wt>`,
      `    <total_shipping>${escapeXml(input.totalShippingTaxIncl)}</total_shipping>`,
      `    <total_shipping_tax_incl>${escapeXml(input.totalShippingTaxIncl)}</total_shipping_tax_incl>`,
      `    <total_shipping_tax_excl>${escapeXml(input.totalShippingTaxIncl)}</total_shipping_tax_excl>`,
      '    <associations>',
      '      <order_rows>',
      orderRows,
      '      </order_rows>',
      '    </associations>',
      '  </order>',
      '</prestashop>',
    ].join('\n');

    const body = await this.send('POST', '/api/orders', xml);
    const order = asRecord(pick(body, 'order'));
    const id = asStringOrNull(pick(order, 'id'));
    if (!id) {
      throw new Error(`PrestaShop createOrder returned no id: ${JSON.stringify(body).slice(0, 200)}`);
    }
    return { id };
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
   * Set the quantity on the product-level `stock_available` row (the
   * `id_product_attribute=0` row — a simple product's only row, and the
   * PS-maintained aggregate on a product with combinations). PrestaShop creates
   * the row on product-create; this reads it back and PUTs the new quantity.
   * Per-combination stock goes through `setCombinationStock`.
   */
  async setStock(productId: string, quantity: number): Promise<void> {
    await this.writeStockRow(productId, '0', quantity);
  }

  /**
   * Set the quantity on ONE combination's `stock_available` row. PrestaShop
   * auto-creates a row per combination on combination-create, so this reads that
   * row back and PUTs the new quantity — the per-variant counterpart to
   * `setStock`, and what makes a provisioned multi-variant product carry
   * DISTINCT per-variant stock (which OL's inventory master then imports
   * one-row-per-variant, #823).
   */
  async setCombinationStock(
    productId: string,
    combinationId: string,
    quantity: number,
  ): Promise<void> {
    await this.writeStockRow(productId, combinationId, quantity);
  }

  /**
   * Locate the `stock_available` row for a product + combination pair
   * (`'0'` = the simple-product / aggregate row) and PUT its quantity.
   */
  private async writeStockRow(
    productId: string,
    idProductAttribute: string,
    quantity: number,
  ): Promise<void> {
    const listing = await this.get(
      `/api/stock_availables?filter[id_product]=${productId}&display=full`,
    );
    const rows = asArray(pick(listing, 'stock_availables')).map(asRecord);
    const row = rows.find(
      (r) => (asStringOrNull(pick(r, 'id_product_attribute')) ?? '0') === idProductAttribute,
    );
    const stockId = row ? asStringOrNull(pick(row, 'id')) : null;
    if (!row || !stockId) {
      throw new Error(
        `PrestaShop setStock: no stock_available row for product ${productId} ` +
          `(id_product_attribute=${idProductAttribute})`,
      );
    }
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
      return JSON.parse(raw) as unknown;
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
      return JSON.parse(raw) as unknown;
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
