/**
 * Shoper Product Master Adapter
 *
 * Implements `ProductMasterPort` over Shoper's REST API - the READ side:
 * `getProduct`, `getProducts`, `getProductVariants`, `searchProducts`,
 * `listExternalIds`, `getCategories` and `getProductCategories`. Every write
 * throws `ShoperNotSupportedException` (a silent no-op would read as "done").
 *
 * Variant model (SPIKE-3638 M1): `products` is the header and `product-stocks`
 * is the variant grain, so each stock row is one `ProductVariant` keyed by its
 * real `stock_id`. Unlike PrestaShop / WooCommerce, no synthetic variant is
 * minted for a simple product - Shoper already gives it a stock row and id.
 *
 * Id handling mirrors `WooCommerceProductMasterAdapter`: methods taking a
 * product id take the INTERNAL one and resolve the Shoper id through the
 * identifier mapping; `listExternalIds` returns Shoper ids.
 *
 * Paging: Shoper pages by page index, caps `limit` at 50 and SILENTLY shrinks a
 * larger one to 10. The caller's `{limit, offset}` is its own WINDOW (a sweep's
 * budget, operator-settable at runtime), not a Shoper page, so the adapter
 * covers any window with pages of 50 and slices - nothing is refused and no
 * window is ever shifted (see `fetchShoperWindow`).
 *
 * Filter syntax, both forms live-verified: `/products` takes the JSON form
 * (`filters={"product_id":{"in":[..]}}`, `{"translations.name":{"like":..}}`),
 * `/product-stocks` takes the bracket form (`filters[product_id]=93`).
 *
 * @module libs/integrations/shoper/src/infrastructure/adapters/product-master
 * @implements {ProductMasterPort}
 */
import type {
  ProductMasterPort,
  Product,
  ProductVariant,
  ProductFilters,
  ProductCreate,
  ProductUpdate,
  ProductVariantCreate,
  Category,
  ProductTaxRateReader,
  ReadProductTaxRateInput,
  TaxRateResolution,
} from '@openlinker/core/products';
import type { IdentifierMappingPort, Connection } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { MasterProductNotFoundError } from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';

import { ShoperApiError } from '../../../domain/exceptions/shoper-api.error';
import { ShoperNetworkError } from '../../../domain/exceptions/shoper-network.error';
import { ShoperNotMappedException } from '../../../domain/exceptions/shoper-not-mapped.exception';
import { ShoperNotSupportedException } from '../../../domain/exceptions/shoper-not-supported.exception';
import type {
  ShoperCategory,
  ShoperCategoryTreeNode,
  ShoperProduct,
  ShoperStock,
} from '../../../domain/types/shoper-api.types';
import { joinShoperCategories } from '../../mappers/shoper-category.mapper';
import { mapShoperTaxRow } from '../../mappers/shoper-tax-rate.mapper';
import type { ShoperTaxTableProvider } from '../../shop-context/shoper-tax-table.provider';
import type { ShoperHttpClient, ShoperQuery } from '../../http/shoper-http-client';
import {
  SHOPER_MAX_PAGE_SIZE,
  fetchShoperPage,
  fetchShoperWindow,
} from '../../http/shoper-pagination';
import {
  mapShoperProduct,
  mapShoperStockToVariant,
} from '../../mappers/shoper-product.mapper';
import type { ShoperShopContextProvider } from '../../shop-context/shoper-shop-context.provider';

/** Explicit direction: a bare `order=<field>` sorts DESCENDING on Shoper. */
const PRODUCT_ORDER = 'product_id ASC';

/** Window used when the caller names none: one Shoper page. */
const DEFAULT_WINDOW = SHOPER_MAX_PAGE_SIZE;

/** A Shoper id is a positive integer; anything else cannot be one. */
const SHOPER_ID = /^\d+$/;

export class ShoperProductMasterAdapter implements ProductMasterPort, ProductTaxRateReader {
  private readonly logger = new Logger(ShoperProductMasterAdapter.name);
  private categoryDirectory: Promise<Category[]> | null = null;
  private readonly productReads = new Map<string, Promise<ShoperProduct>>();

  constructor(
    private readonly client: ShoperHttpClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly shopContext: ShoperShopContextProvider,
    private readonly taxTable: ShoperTaxTableProvider,
    private readonly connection: Connection,
  ) {}

  // ─── Read methods ──────────────────────────────────────────────────────────

  async listExternalIds(filters?: { limit?: number; offset?: number }): Promise<string[]> {
    const rows = await fetchShoperWindow<Pick<ShoperProduct, 'product_id'>>(
      this.client,
      '/products',
      {
        offset: filters?.offset ?? 0,
        limit: filters?.limit ?? DEFAULT_WINDOW,
        query: { order: PRODUCT_ORDER },
      },
    );
    return rows.map((p) => String(p.product_id));
  }

  async getProduct(productId: string): Promise<Product> {
    const externalId = await this.resolveExternalProductId(productId);
    let data: ShoperProduct;
    try {
      data = await this.readProduct(externalId);
    } catch (error) {
      // The port boundary where a master-side deletion becomes the neutral
      // error core stales variants on (#1599). Only a 404 Shoper itself
      // reported counts - see `ShoperApiError.isResourceNotFound`.
      if (error instanceof ShoperApiError && error.isResourceNotFound()) {
        throw new MasterProductNotFoundError(productId, this.connection.id, error);
      }
      throw error;
    }
    const ctx = await this.shopContext.get();
    return { ...mapShoperProduct(data, ctx), id: productId };
  }

  async getProducts(filters?: ProductFilters): Promise<Product[]> {
    this.assertSupportedFilters(filters);

    const query: Record<string, string | number> = { order: PRODUCT_ORDER };
    const where = this.buildWhere(filters);

    if (filters?.externalIds !== undefined) {
      return this.getProductsByExternalIds(filters.externalIds, where);
    }

    if (where !== null) {
      query.filters = JSON.stringify(where);
    }
    const rows = await fetchShoperWindow<ShoperProduct>(this.client, '/products', {
      offset: filters?.offset ?? 0,
      limit: filters?.limit ?? DEFAULT_WINDOW,
      query,
    });
    return this.toProducts(rows);
  }

  async getProductVariants(productId: string): Promise<ProductVariant[]> {
    const externalId = await this.resolveExternalProductId(productId);
    const ctx = await this.shopContext.get();
    const stocks = await this.fetchAllStocks(externalId);
    if (stocks.length === 0) {
      return [];
    }

    const idMap = await this.identifierMapping.batchGetOrCreateInternalIds(
      stocks.map((s) => ({
        entityType: CORE_ENTITY_TYPE.ProductVariant,
        externalId: s.stock_id,
        connectionId: this.connection.id,
        context: {
          parentEntityType: CORE_ENTITY_TYPE.Product,
          parentInternalId: productId,
          metadata: { variantExternalId: s.stock_id },
        },
      })),
    );

    const variants: ProductVariant[] = [];
    for (const stock of stocks) {
      const internalId = idMap.get(`${stock.stock_id}:${this.connection.id}`);
      if (internalId === undefined) {
        this.logger.warn(`No internal id for Shoper stock ${stock.stock_id}`);
        continue;
      }
      variants.push({ ...mapShoperStockToVariant(stock, productId, ctx), id: internalId });
    }
    return variants;
  }

  searchProducts(query: string, filters?: ProductFilters): Promise<Product[]> {
    return this.getProducts({ ...filters, query });
  }

  // ─── Tax rate (ADR-063) ────────────────────────────────────────────────────

  /**
   * The rate the shop assigns this product, as an ADR-063 code. Tax lives on
   * the Shoper PRODUCT, not the stock row, so `variantId` is not consulted
   * (`readsTaxRatePerVariant()` is false).
   *
   * Never guesses: no fallback to the shop default tax or to 23%. A missing
   * `tax_id` is the shop's answer (`not-configured`, persisted, fixed in the
   * shop); a `tax_id` absent from `/taxes`, a row name this build does not
   * recognise, or a row whose name and `value` contradict each other
   * established nothing (`unreadable`, not persisted). Transport
   * failures propagate - turning one into an answer would let a single 500
   * during a sweep mark products rate-less.
   */
  async readProductTaxRate(input: ReadProductTaxRateInput): Promise<TaxRateResolution> {
    const externalId = await this.resolveExternalProductId(input.productId);
    const data = await this.readProduct(externalId);

    const taxId = data.tax_id === null || data.tax_id === undefined ? '' : String(data.tax_id).trim();
    if (taxId.length === 0 || taxId === '0') {
      return {
        kind: 'unknown',
        reason: 'not-configured',
        detail: `Shoper product ${externalId} has no tax rate assigned`,
      };
    }

    const row = (await this.taxTable.get()).get(taxId);
    if (row === undefined) {
      return {
        kind: 'unknown',
        reason: 'unreadable',
        detail: `Shoper tax_id ${taxId} is not in the shop's tax table`,
      };
    }

    // The name alone is not trusted: it is a label a merchant can edit, and the
    // result feeds a fiscal document, so `value` must agree with it.
    const rate = mapShoperTaxRow(row);
    if (!rate.ok) {
      return { kind: 'unknown', reason: 'unreadable', detail: rate.detail };
    }

    return { kind: 'resolved', code: rate.code, countryIso2: null };
  }

  readsTaxRatePerVariant(): boolean {
    return false;
  }

  // ─── Categories ────────────────────────────────────────────────────────────

  /**
   * The master's whole category directory: structure from `categories-tree`,
   * names from the paged `categories` list (the tree carries ids only).
   *
   * Built at most ONCE per adapter instance: a caller resolving categories for
   * a page of products would otherwise rebuild the whole directory (the tree
   * plus every list page) per product, against a shop with an unknown request
   * ceiling. Memoised as a promise so concurrent callers share one build, and a
   * failure is dropped so the next call retries. Each caller gets its own array.
   */
  async getCategories(): Promise<Category[]> {
    if (this.categoryDirectory === null) {
      this.categoryDirectory = this.loadCategoryDirectory().catch((error: unknown) => {
        this.categoryDirectory = null;
        throw error;
      });
    }
    return [...(await this.categoryDirectory)];
  }

  private async loadCategoryDirectory(): Promise<Category[]> {
    const [tree, list, ctx] = await Promise.all([
      this.client.get<ShoperCategoryTreeNode[]>('/categories-tree'),
      this.fetchAllCategories(),
      this.shopContext.get(),
    ]);
    // A legitimately empty tree is `[]`. Anything else that is not an array is
    // an unreadable answer, and reading it as "no structure" would return every
    // category as an unplaced root, dressed up as the real directory.
    if (!Array.isArray(tree.data)) {
      throw new ShoperNetworkError('Shoper returned an unreadable category tree');
    }
    const joined = joinShoperCategories(list, tree.data, ctx.language);
    if (joined.unnamedIds.length > 0) {
      this.logger.warn(
        `Shoper categories with no name in any language, skipped: ${joined.unnamedIds.join(',')} ` +
          `(connection: ${this.connection.id})`,
      );
    }
    if (joined.unnamedTreeIds.length > 0) {
      this.logger.warn(
        `Shoper category tree lists ids with no category record, skipped: ${joined.unnamedTreeIds.join(',')} ` +
          `(connection: ${this.connection.id})`,
      );
    }
    if (joined.unplacedIds.length > 0) {
      this.logger.warn(
        `Shoper categories missing from the category tree, returned without a parent: ` +
          `${joined.unplacedIds.join(',')} (connection: ${this.connection.id})`,
      );
    }
    return joined.categories;
  }

  /**
   * A 404 here is a plain `ShoperApiError`, not the neutral not-found: deletion
   * is detected at `getProduct`, the port boundary core stales on, never as a
   * side effect of a category read.
   */
  async getProductCategories(productId: string): Promise<Category[]> {
    const externalId = await this.resolveExternalProductId(productId);
    const data = await this.readProduct(externalId);
    const ids = Array.isArray(data.categories) ? data.categories.map(String) : [];
    if (ids.length === 0) {
      return [];
    }

    const directory = new Map((await this.getCategories()).map((c) => [c.id, c]));
    const categories: Category[] = [];
    for (const id of ids) {
      const category = directory.get(id);
      if (category === undefined) {
        this.logger.warn(
          `Shoper product ${externalId} references unknown category ${id}, skipped (connection: ${this.connection.id})`,
        );
        continue;
      }
      categories.push(category);
    }
    return categories;
  }

  // ─── Not supported in this milestone ───────────────────────────────────────

  createProduct(_product: ProductCreate): Promise<Product> {
    return Promise.reject(new ShoperNotSupportedException('createProduct'));
  }

  updateProduct(_productId: string, _product: ProductUpdate): Promise<Product> {
    return Promise.reject(new ShoperNotSupportedException('updateProduct'));
  }

  deleteProduct(_productId: string): Promise<void> {
    return Promise.reject(new ShoperNotSupportedException('deleteProduct'));
  }

  upsertProductVariant(
    _productId: string,
    _variant: ProductVariantCreate,
  ): Promise<ProductVariant> {
    return Promise.reject(new ShoperNotSupportedException('upsertProductVariant'));
  }

  assignCategories(_productId: string, _categoryIds: string[]): Promise<void> {
    return Promise.reject(new ShoperNotSupportedException('assignCategories'));
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /**
   * `GET /products/:id`, shared within this adapter instance. One resolution
   * typically calls `getProduct` and then `getProductCategories` for the same
   * product; without this they would issue the same request twice. Promise
   * memo, failure not kept (the next call retries). The instance lives for one
   * resolution, so a cached payload cannot go meaningfully stale.
   */
  private readProduct(externalId: string): Promise<ShoperProduct> {
    let read = this.productReads.get(externalId);
    if (read === undefined) {
      read = this.client.get<ShoperProduct>(`/products/${externalId}`).then((r) => r.data);
      this.productReads.set(externalId, read);
      read.catch(() => this.productReads.delete(externalId));
    }
    return read;
  }

  private async resolveExternalProductId(productId: string): Promise<string> {
    const mappings = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Product,
      productId,
    );
    const mapping = mappings.find((m) => m.connectionId === this.connection.id);
    if (mapping === undefined) {
      throw new ShoperNotMappedException(productId, this.connection.id);
    }
    return mapping.externalId;
  }

  /**
   * Filters Shoper cannot express on `products` are REFUSED, never ignored: an
   * ignored filter would return a wider set than the caller asked for.
   */
  private assertSupportedFilters(filters: ProductFilters | undefined): void {
    if (filters?.categoryIds !== undefined && filters.categoryIds.length > 0) {
      throw new ShoperNotSupportedException('getProducts filter "categoryIds"');
    }
    if (filters?.status !== undefined) {
      throw new ShoperNotSupportedException('getProducts filter "status"');
    }
  }

  /** The JSON `filters` object (verified form), or null when nothing narrows the set. */
  private buildWhere(filters: ProductFilters | undefined): Record<string, unknown> | null {
    const where: Record<string, unknown> = {};
    if (filters?.query !== undefined && filters.query.trim().length > 0) {
      where['translations.name'] = { like: `%${filters.query.trim()}%` };
    }
    return Object.keys(where).length > 0 ? where : null;
  }

  /**
   * An id Shoper never returns is simply ABSENT from the result - this method
   * cannot tell "deleted" from "not returned". Deletion is detected where the
   * shop says so explicitly: a 404 on `getProduct` (see `MasterProductNotFoundError`).
   *
   * An id that is not a positive integer cannot be a Shoper id; it is skipped
   * and logged, never sent (`Number('x')` would become `null` in the JSON
   * filter and silently widen or break the query).
   */
  private async getProductsByExternalIds(
    externalIds: readonly string[],
    where: Record<string, unknown> | null,
  ): Promise<Product[]> {
    const valid = externalIds.filter((id) => SHOPER_ID.test(id));
    if (valid.length < externalIds.length) {
      this.logger.warn(
        `Ignoring ${externalIds.length - valid.length} non-numeric product id(s) ` +
          `(connection: ${this.connection.id})`,
      );
    }

    const products: Product[] = [];
    for (let i = 0; i < valid.length; i += SHOPER_MAX_PAGE_SIZE) {
      const chunk = valid.slice(i, i + SHOPER_MAX_PAGE_SIZE);
      const filtersParam: Record<string, unknown> = {
        ...where,
        product_id: { in: chunk.map(Number) },
      };
      const query: ShoperQuery = { order: PRODUCT_ORDER, filters: JSON.stringify(filtersParam) };
      const result = await fetchShoperPage<ShoperProduct>(this.client, '/products', {
        page: 1,
        limit: SHOPER_MAX_PAGE_SIZE,
        query,
      });
      products.push(...(await this.toProducts(result.items)));
    }
    return products;
  }

  private async toProducts(items: readonly ShoperProduct[]): Promise<Product[]> {
    if (items.length === 0) {
      return [];
    }
    const ctx = await this.shopContext.get();
    const idMap = await this.identifierMapping.batchGetOrCreateInternalIds(
      items.map((p) => ({
        entityType: CORE_ENTITY_TYPE.Product,
        externalId: p.product_id,
        connectionId: this.connection.id,
      })),
    );

    const products: Product[] = [];
    for (const raw of items) {
      const internalId = idMap.get(`${raw.product_id}:${this.connection.id}`);
      if (internalId === undefined) {
        this.logger.warn(`No internal id for Shoper product ${raw.product_id}`);
        continue;
      }
      products.push({ ...mapShoperProduct(raw, ctx), id: internalId });
    }
    return products;
  }

  private async fetchAllCategories(): Promise<ShoperCategory[]> {
    const categories: ShoperCategory[] = [];
    for (let page = 1; ; page += 1) {
      const result = await fetchShoperPage<ShoperCategory>(this.client, '/categories', {
        page,
        limit: SHOPER_MAX_PAGE_SIZE,
        query: { order: 'category_id ASC' },
      });
      categories.push(...result.items);
      if (page >= result.pages) {
        return categories;
      }
    }
  }

  /** Exhausts every page of a product's stocks (a product may have more than 50 variants). */
  private async fetchAllStocks(externalProductId: string): Promise<ShoperStock[]> {
    const stocks: ShoperStock[] = [];
    let page = 1;
    for (;;) {
      const result = await fetchShoperPage<ShoperStock>(this.client, '/product-stocks', {
        page,
        limit: SHOPER_MAX_PAGE_SIZE,
        query: { 'filters[product_id]': externalProductId, order: 'stock_id ASC' },
      });
      stocks.push(...this.onlyStocksOf(externalProductId, result.items));
      if (page >= result.pages) {
        return stocks;
      }
      page += 1;
    }
  }

  /**
   * Guard against the filter being ignored. Shoper silently rewrites invalid
   * parameters (`limit` -> 10), so a `filters[product_id]` it stopped honouring
   * would answer with the WHOLE stock table, and every product would be handed
   * foreign variants under a wrong parent. A row that is not this product's is
   * dropped and logged.
   */
  private onlyStocksOf(externalProductId: string, rows: readonly ShoperStock[]): ShoperStock[] {
    const own = rows.filter((s) => String(s.product_id) === externalProductId);
    if (own.length < rows.length) {
      this.logger.warn(
        `Shoper returned ${rows.length - own.length} stock row(s) of another product while ` +
          `reading product ${externalProductId}; dropped (connection: ${this.connection.id})`,
      );
    }
    return own;
  }
}
