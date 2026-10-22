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
import { Logger } from '@openlinker/shared/logging';

import { ShoperNotSupportedException } from '../../../domain/exceptions/shoper-not-supported.exception';
import type {
  ShoperCategory,
  ShoperCategoryTreeNode,
  ShoperProduct,
  ShoperStock,
} from '../../../domain/types/shoper-api.types';
import { ShoperCategoryReader } from '../../readers/shoper-category.reader';
import {
  buildShoperCategoryBreadcrumb,
  joinShoperCategories,
  shoperCategoryPathIds,
} from '../../mappers/shoper-category.mapper';
import { mapShoperTaxRow } from '../../mappers/shoper-tax-rate.mapper';
import type { ShoperOptionEntry, ShoperOptionTableProvider } from '../../shop-context/shoper-option-table.provider';
import type { ShoperTaxTableProvider } from '../../shop-context/shoper-tax-table.provider';
import type { ShoperHttpClient, ShoperQuery } from '../../http/shoper-http-client';
import {
  SHOPER_MAX_PAGE_SIZE,
  fetchShoperPage,
  fetchShoperWindow,
} from '../../http/shoper-pagination';
import { fetchShoperProductImages } from '../../http/shoper-product-images';
import { fetchShoperStocks } from '../../http/shoper-stocks';
import {
  buildShoperGalleryUrls,
  mapShoperProduct,
  mapShoperStockToVariant,
  partitionShoperStocks,
  resolveShoperVariantAttributes,
  shoperStockOptionPairs,
} from '../../mappers/shoper-product.mapper';
import { resolveShoperExternalProductId } from '../../readers/shoper-product-id';
import type { ShoperProductReader } from '../../readers/shoper-product.reader';
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
  private readonly categoryReader: ShoperCategoryReader;
  private readonly productReader: ShoperProductReader;

  constructor(
    private readonly client: ShoperHttpClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly shopContext: ShoperShopContextProvider,
    private readonly taxTable: ShoperTaxTableProvider,
    private readonly optionTable: ShoperOptionTableProvider,
    private readonly connection: Connection,
    // Shared with the InventoryMaster adapter of the same resolution, so a
    // product is read (and a deletion reported) once.
    productReader: ShoperProductReader,
  ) {
    this.productReader = productReader;
    this.categoryReader = new ShoperCategoryReader(client);
  }

  // ─── Read methods ──────────────────────────────────────────────────────────

  async listExternalIds(filters?: { limit?: number; offset?: number }): Promise<string[]> {
    const rows = await fetchShoperWindow<Pick<ShoperProduct, 'product_id'>>(
      this.client,
      '/products',
      {
        offset: filters?.offset ?? 0,
        limit: filters?.limit ?? DEFAULT_WINDOW,
        query: { order: PRODUCT_ORDER },
      }
    );
    return rows.map((p) => String(p.product_id));
  }

  async getProduct(productId: string): Promise<Product> {
    const externalId = await this.resolveExternalProductId(productId);
    // The shop context does not depend on the product, so it is read alongside
    // it. The product read is still awaited first: a deleted product must
    // surface its own not-found (#1599), never a context failure that lost the
    // race. The no-op catch only stops an unawaited rejection from being
    // reported as unhandled; the awaited promise below still rejects.
    const ctxRead = this.shopContext.get();
    ctxRead.catch(() => undefined);
    const data = await this.readProduct(externalId, productId);
    const ctx = await ctxRead;
    const product = mapShoperProduct(data, ctx);
    const gallery = await this.readGallery(externalId, ctx.host);
    const categoryBreadcrumb = await this.readCategoryBreadcrumb(data, ctx.language);
    return {
      ...product,
      // An empty or unreadable gallery keeps the main image the product row carries.
      images: gallery.length > 0 ? gallery : product.images,
      ...(categoryBreadcrumb === null ? {} : { categoryBreadcrumb }),
      id: productId,
    };
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
    // A product with variants also has a base row nobody can buy; it is left
    // out, and kept only to resolve prices and weights stated relative to it.
    const { variants: stocks, base } = partitionShoperStocks(await this.fetchAllStocks(externalId));
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
      }))
    );

    const variants: ProductVariant[] = [];
    for (const stock of stocks) {
      const internalId = idMap.get(`${stock.stock_id}:${this.connection.id}`);
      if (internalId === undefined) {
        this.logger.warn(`No internal id for Shoper stock ${stock.stock_id}`);
        continue;
      }
      const attributes = await this.resolveVariantAttributes(stock, ctx.language);
      variants.push({
        ...mapShoperStockToVariant(stock, productId, ctx, attributes, base),
        id: internalId,
      });
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
    const data = await this.readProduct(externalId, input.productId);

    const taxId =
      data.tax_id === null || data.tax_id === undefined ? '' : String(data.tax_id).trim();
    // `'0'` is treated as "no tax group" - unverified live (see README); holds, never guesses.
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
    const [raw, ctx] = await Promise.all([this.categoryReader.read(), this.shopContext.get()]);
    const joined = joinShoperCategories(raw.list, raw.tree, ctx.language);
    if (joined.unnamedIds.length > 0) {
      this.logger.warn(
        `Shoper categories with no name in any language, skipped: ${joined.unnamedIds.join(',')} ` +
          `(connection: ${this.connection.id})`
      );
    }
    if (joined.unnamedTreeIds.length > 0) {
      this.logger.warn(
        `Shoper category tree lists ids with no category record, skipped: ${joined.unnamedTreeIds.join(',')} ` +
          `(connection: ${this.connection.id})`
      );
    }
    if (joined.unplacedIds.length > 0) {
      this.logger.warn(
        `Shoper categories missing from the category tree, returned without a parent: ` +
          `${joined.unplacedIds.join(',')} (connection: ${this.connection.id})`
      );
    }
    return joined.categories;
  }

  /**
   * Reads the product through the same translating read as `getProduct`, so a
   * product Shoper reports gone surfaces here as the neutral
   * `MasterProductNotFoundError` too - core may reach a deleted product through
   * this method first, and a plain `ShoperApiError` would miss the deletion.
   */
  async getProductCategories(productId: string): Promise<Category[]> {
    const externalId = await this.resolveExternalProductId(productId);
    const data = await this.readProduct(externalId, productId);
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
          `Shoper product ${externalId} references unknown category ${id}, skipped (connection: ${this.connection.id})`
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
    _variant: ProductVariantCreate
  ): Promise<ProductVariant> {
    return Promise.reject(new ShoperNotSupportedException('upsertProductVariant'));
  }

  assignCategories(_productId: string, _categoryIds: string[]): Promise<void> {
    return Promise.reject(new ShoperNotSupportedException('assignCategories'));
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /**
   * `GET /products/:id` through the shared `ShoperProductReader`: one request
   * per product per resolution, and THE place a master-side deletion becomes the
   * neutral error core stales variants on (#1599). `getProduct`,
   * `getProductCategories` and `readProductTaxRate` all read through here - and
   * so does the `InventoryMaster` adapter when the factory hands both the same
   * reader - so whichever core reaches a deleted product through first reports it.
   */
  private readProduct(externalId: string, productId: string): Promise<ShoperProduct> {
    return this.productReader.read(externalId, productId);
  }

  private resolveExternalProductId(productId: string): Promise<string> {
    return resolveShoperExternalProductId(this.identifierMapping, this.connection.id, productId);
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
    where: Record<string, unknown> | null
  ): Promise<Product[]> {
    const valid = externalIds.filter((id) => SHOPER_ID.test(id));
    if (valid.length < externalIds.length) {
      this.logger.warn(
        `Ignoring ${externalIds.length - valid.length} non-numeric product id(s) ` +
          `(connection: ${this.connection.id})`
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
      }))
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

  /** Exhausts every page of a product's stocks (a product may have more than 50 variants). */
  /**
   * `{ option name: value text }` for a stock, or `null` when it has no options or
   * they cannot ALL be resolved - logged, never guessed. A transport failure
   * propagates: turning it into `null` would let one 500 during a sweep wipe the
   * attributes a variant already had.
   */
  private async resolveVariantAttributes(
    stock: ShoperStock,
    language: string,
  ): Promise<Record<string, string> | null> {
    const pairs = shoperStockOptionPairs(stock.options);
    const optionIds = pairs === 'malformed' ? [] : [...new Set(pairs.map(([optionId]) => optionId))];
    const loaded = await Promise.all(optionIds.map((id) => this.optionTable.get(id)));
    const entries = new Map<string, ShoperOptionEntry | null>(optionIds.map((id, i) => [id, loaded[i]]));

    const { attributes, problem } = resolveShoperVariantAttributes(stock.options, entries, language);
    if (problem !== undefined) {
      this.logger.warn(
        `Shoper stock ${stock.stock_id} syncs without attributes: ${problem} (connection: ${this.connection.id})`,
      );
    }
    return attributes;
  }

  /**
   * The product's gallery URLs, or `[]` when it cannot be read. A failure is
   * logged and does not fail the product read: the price, stock and text of a
   * product matter more than its extra photos, and the caller keeps the main
   * image. The cost is that a failed read shows only the main image until the
   * next sync reads the gallery again.
   */
  private async readGallery(externalProductId: string, host: string): Promise<string[]> {
    try {
      const images = await fetchShoperProductImages(this.client, externalProductId, (count) =>
        this.logger.warn(
          `Shoper returned ${count} image row(s) of another product while reading product ` +
            `${externalProductId}; dropped (connection: ${this.connection.id})`,
        ),
      );
      return buildShoperGalleryUrls(host, images);
    } catch (error) {
      this.logger.warn(
        `Shoper gallery of product ${externalProductId} could not be read; keeping the main image ` +
          `(${error instanceof Error ? error.message : String(error)}, connection: ${this.connection.id})`,
      );
      return [];
    }
  }

  /**
   * The path of the product's main category (`category_id`, else its first
   * category), root to leaf, or `null` when it has none or it cannot be read.
   *
   * Two requests, whatever the size of the shop: the tree (structure, ids only)
   * and ONE filtered page of `/categories` for the names of the path's nodes -
   * not the whole directory, which this per-product read would otherwise rebuild
   * for every product a sweep syncs. Best-effort like the gallery: a failure is
   * logged and the product syncs without a path.
   */
  private async readCategoryBreadcrumb(
    data: ShoperProduct,
    language: string,
  ): Promise<{ id: string; name: string }[] | null> {
    const main = data.category_id === null || data.category_id === undefined ? '' : String(data.category_id).trim();
    const leafId =
      main.length > 0 && main !== '0'
        ? main
        : Array.isArray(data.categories) && data.categories.length > 0
          ? String(data.categories[0])
          : null;
    if (leafId === null) {
      return null;
    }
    try {
      const tree = await this.client.get<ShoperCategoryTreeNode[]>('/categories-tree');
      const pathIds = Array.isArray(tree.data) ? shoperCategoryPathIds(tree.data, leafId) : null;
      if (pathIds === null) {
        this.logger.warn(
          `Shoper category ${leafId} of product ${data.product_id} is not in the category tree; ` +
            `syncing without a category path (connection: ${this.connection.id})`,
        );
        return null;
      }
      const page = await fetchShoperPage<ShoperCategory>(this.client, '/categories', {
        page: 1,
        limit: SHOPER_MAX_PAGE_SIZE,
        query: { filters: JSON.stringify({ category_id: { in: pathIds.map(Number) } }) },
      });
      const wanted = new Set(pathIds);
      const breadcrumb = buildShoperCategoryBreadcrumb(
        pathIds,
        page.items.filter((raw) => wanted.has(String(raw.category_id))),
        language,
      );
      if (breadcrumb === null) {
        this.logger.warn(
          `Shoper category path of product ${data.product_id} has a node with no name; ` +
            `syncing without a category path (connection: ${this.connection.id})`,
        );
      }
      return breadcrumb;
    } catch (error) {
      this.logger.warn(
        `Shoper category path of product ${data.product_id} could not be read; syncing without it ` +
          `(${error instanceof Error ? error.message : String(error)}, connection: ${this.connection.id})`,
      );
      return null;
    }
  }

  private fetchAllStocks(externalProductId: string): Promise<ShoperStock[]> {
    // The filter-ignored guard lives in `fetchShoperStocks`; this only reports it.
    return fetchShoperStocks(this.client, externalProductId, (count) =>
      this.logger.warn(
        `Shoper returned ${count} stock row(s) of another product while reading product ` +
          `${externalProductId}; dropped (connection: ${this.connection.id})`,
      ),
    );
  }
}
