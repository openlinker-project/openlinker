/**
 * Shoper Product Master Adapter
 *
 * Implements `ProductMasterPort` over Shoper's REST API - the READ side:
 * `getProduct`, `getProducts`, `getProductVariants`, `searchProducts`,
 * `listExternalIds`, `getCategories` and `getProductCategories`. Every write
 * throws `ShoperNotSupportedException` (a silent no-op would read as "done").
 *
 * Also implements two guard-only rungs (ADR-048), never advertised in the
 * manifest: `ModifiedProductLister` over the `edit_date` filter - see
 * `listExternalIdsModifiedSince` for what that timestamp does and does not
 * cover - and `BulkProductReader`, a prefetch that warms a batch's products and
 * stock rows in a few requests (see `prefetchProducts`).
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
 * GPSR: `getProduct` / `getProducts` resolve the product's `safety_information`
 * references through `ShoperGpsrReader` (the four `product-safety-*`
 * registries, each read at most once per adapter instance and only when a
 * product references it) into the neutral `Product.gpsr`. A failed or dangling
 * reference leaves `gpsr` undefined - unknown - and never fails the read.
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
  ModifiedProductLister,
  ListExternalIdsModifiedSinceInput,
  BulkProductReader,
} from '@openlinker/core/products';
import type { IdentifierMappingPort, Connection } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';

import { ShoperNotSupportedException } from '../../../domain/exceptions/shoper-not-supported.exception';
import type {
  ShoperProduct,
  ShoperStock,
} from '../../../domain/types/shoper-api.types';
import { ShoperCategoryReader } from '../../readers/shoper-category.reader';
import { joinShoperCategories, primaryShoperCategoryId } from '../../mappers/shoper-category.mapper';
import { mapShoperTaxRow } from '../../mappers/shoper-tax-rate.mapper';
import { toShoperLocalBound } from '../../mappers/shoper-shop-time.mapper';
import type { ShoperOptionEntry, ShoperOptionTableProvider } from '../../shop-context/shoper-option-table.provider';
import type { ShoperTaxTableProvider } from '../../shop-context/shoper-tax-table.provider';
import type { ShoperHttpClient, ShoperQuery } from '../../http/shoper-http-client';
import {
  SHOPER_MAX_PAGE_SIZE,
  fetchShoperPage,
  fetchShoperWindow,
} from '../../http/shoper-pagination';
import { fetchShoperProductImages } from '../../http/shoper-product-images';
import { fetchShoperStocks, fetchShoperStocksForProducts } from '../../http/shoper-stocks';
import {
  buildShoperGalleryUrls,
  mapShoperProduct,
  mapShoperStockToVariant,
  partitionShoperStocks,
  resolveShoperVariantAttributes,
  shoperStockOptionPairs,
} from '../../mappers/shoper-product.mapper';
import { resolveShoperExternalProductId } from '../../readers/shoper-product-id';
import { ShoperGpsrReader } from '../../readers/shoper-gpsr.reader';
import type { ShoperProductReader } from '../../readers/shoper-product.reader';
import type { ShoperShopContextProvider } from '../../shop-context/shoper-shop-context.provider';

/** Explicit direction: a bare `order=<field>` sorts DESCENDING on Shoper. */
const PRODUCT_ORDER = 'product_id ASC';

/** Window used when the caller names none: one Shoper page. */
const DEFAULT_WINDOW = SHOPER_MAX_PAGE_SIZE;

/** A Shoper id is a positive integer; anything else cannot be one. */
const SHOPER_ID = /^\d+$/;

export class ShoperProductMasterAdapter
  implements ProductMasterPort, ProductTaxRateReader, ModifiedProductLister, BulkProductReader
{
  private readonly logger = new Logger(ShoperProductMasterAdapter.name);
  private categoryDirectory: Promise<Category[]> | null = null;
  /** Stock rows warmed by `prefetchProducts`, keyed by Shoper product id. Read-only paths only. */
  private readonly stockCache = new Map<string, ShoperStock[]>();
  private readonly categoryReader: ShoperCategoryReader;
  private readonly productReader: ShoperProductReader;
  private readonly gpsrReader: ShoperGpsrReader;

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
    this.gpsrReader = new ShoperGpsrReader(client, connection.id);
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

  /**
   * Shoper ids of the products whose `edit_date` is at or after `since`
   * (`filters={"edit_date":{">=":"<shop-local time>"}}`, live-verified).
   *
   * WHAT BUMPS `edit_date` (measured on a live shop, 2026-10-22/23): a name or
   * category edit, a variant's stock or price written through the API, adding a
   * variant, a sale, and an order line being added. WHAT DOES NOT: deleting a
   * variant through the API, adding or deleting an image, and stock coming back
   * (an order line deleted, the panel's "return to stock"). Those changes are
   * invisible to this rung, so the full `master.product.syncAll` pass stays the
   * backstop, and stock is not this rung's business at all - the inventory sweep
   * owns it. A caller must not read an empty result as "nothing changed".
   *
   * TIME: `edit_date` is a naive shop-local timestamp, so `since` is rendered in
   * the shop's zone (`application-config.locale_timezone`, Europe/Warsaw on every
   * shop seen) by `toShoperLocalBound`, which only ever errs EARLY: an unknown
   * zone widens the bound by 14 h, and a DST fall-back within the next hour
   * moves it back by the repeated hour. Re-reading a product is free; skipping
   * one is not.
   *
   * ORDER: `product_id ASC`, deliberately NOT `edit_date ASC`. Offset paging over
   * a live set is stable only if a row does not MOVE while the cycle reads it.
   * Under `edit_date` order a product re-edited mid-cycle jumps to the tail and
   * shifts every later row one place left, stepping over one; under `product_id`
   * order it stays put, a product entering the set only shifts rows RIGHT (one
   * re-read, harmless) and a new product lands at the tail. It is also the one
   * order the other sweeps already rely on, and a single unique key, so there
   * are no ties for the shop to break differently between two pages.
   */
  async listExternalIdsModifiedSince(input: ListExternalIdsModifiedSinceInput): Promise<string[]> {
    const { timezone } = await this.shopContext.get();
    const bound = toShoperLocalBound(input.since, timezone ?? null);
    const rows = await fetchShoperWindow<Pick<ShoperProduct, 'product_id'>>(
      this.client,
      '/products',
      {
        offset: input.offset,
        limit: input.limit,
        query: {
          order: PRODUCT_ORDER,
          filters: JSON.stringify({ edit_date: { '>=': bound } }),
        },
      }
    );
    return rows.map((p) => String(p.product_id));
  }

  /**
   * Warm a batch's products and stock rows (#2593 shape, `BulkProductReader`):
   * per chunk of 50 ids, ONE `GET /products?filters={"product_id":{"in":[..]}}`
   * seeding the shared product reader, and one filtered `/product-stocks` read
   * for the products it returned. The per-product loop that follows then reads
   * `/products/:id` and the product's stocks from memory - `getProduct`,
   * `getProductCategories`, `readProductTaxRate` and `getProductVariants` all
   * hit the warm copies - against two requests per product without it.
   *
   * Invisible except in request count, as the contract requires:
   *   - An id the shop did NOT return is left unwarmed, product and stocks, so
   *     its own `GET /products/:id` is what answers - and a 404 there is the
   *     deletion signal, exactly as without the prefetch. Nothing here concludes
   *     a deletion from an absence.
   *   - A stock bucket is seeded only for a product the products read returned,
   *     so an empty bucket means "the shop listed this product and no stock rows
   *     for it" - the same answer its own stocks read would give.
   *   - A row of an id nobody asked for means the filter was dropped; the chunk
   *     is refused before anything from it is seeded.
   *   - Any failure is logged and swallowed; whatever was not warmed is read per
   *     product as before. No identifier mapping is created here.
   */
  async prefetchProducts(externalIds: readonly string[]): Promise<void> {
    const ids = [...new Set(externalIds.map(String))].filter((id) => SHOPER_ID.test(id));
    let warmed = 0;
    try {
      for (let i = 0; i < ids.length; i += SHOPER_MAX_PAGE_SIZE) {
        warmed += await this.prefetchChunk(ids.slice(i, i + SHOPER_MAX_PAGE_SIZE));
      }
    } catch (error) {
      this.logger.warn(
        `Shoper bulk product prefetch failed for ${ids.length} product(s) ` +
          `(connection: ${this.connection.id}); falling back to per-product reads: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (warmed > 0) {
      // The category directory serves every product's placement path and
      // breadcrumb; warming it here keeps the per-product loop request-free.
      // Best-effort: a failure leaves each product to read it on its own.
      await this.getCategories().catch((error: unknown) =>
        this.logger.warn(
          `Shoper category directory could not be prefetched (connection: ${this.connection.id}): ` +
            `${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /** Warms one chunk; returns how many of its products the shop returned. */
  private async prefetchChunk(chunk: readonly string[]): Promise<number> {
    const result = await fetchShoperPage<ShoperProduct>(this.client, '/products', {
      page: 1,
      limit: SHOPER_MAX_PAGE_SIZE,
      query: {
        order: PRODUCT_ORDER,
        filters: JSON.stringify({ product_id: { in: chunk.map(Number) } }),
      },
    });
    const requested = new Set(chunk);
    for (const product of result.items) {
      if (!requested.has(String(product.product_id))) {
        throw new Error(
          `Shoper answered a products read for ${chunk.length} id(s) with product ` +
            `${String(product.product_id)}, which was not asked for - the filter was not applied`
        );
      }
    }

    const returned = result.items.map((product) => String(product.product_id));
    for (const product of result.items) {
      this.productReader.seed(String(product.product_id), product);
    }
    if (returned.length === 0) {
      return 0;
    }
    const stocks = await fetchShoperStocksForProducts(this.client, returned);
    for (const [id, rows] of stocks) {
      this.stockCache.set(id, rows);
    }
    return returned.length;
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
    // Independent reads, and neither throws: each logs its own failure and
    // falls back, so running them together changes no outcome.
    const [gallery, categoryBreadcrumb] = await Promise.all([
      this.readGallery(externalId, ctx.host),
      this.readCategoryBreadcrumb(data),
    ]);
    return this.withGpsr(
      {
        ...product,
        // An empty or unreadable gallery keeps the main image the product row carries.
        images: gallery.length > 0 ? gallery : product.images,
        ...(categoryBreadcrumb === null ? {} : { categoryBreadcrumb }),
        id: productId,
      },
      data,
    );
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
   * plus every list page) per product, against a request budget of about 10/s
   * per shop that every integration on it shares. Memoised as a promise so concurrent callers share one build, and a
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
   * The product's placement as ONE path, root to leaf: the primary category
   * (`category_id`) and every ancestor above it, each carrying the `parentId` and
   * tree `depth` of the directory. The publish builder provisions exactly this
   * path on the destination, so returning the leaf alone made it create the leaf
   * a second time at the root (a product in "Kuchnia > Zestawy" published into a
   * new root "Zestawy").
   *
   * Single-branch, the same rule the PrestaShop master follows with
   * `id_category_default`: the other categories a Shoper product is also
   * assigned to are not returned, because the builder treats the list as one
   * path and a second branch would be stitched into it. Only when Shoper names
   * no primary category is a sole entry of `categories` used as the anchor.
   *
   * A path that cannot be completed - the anchor or an ancestor is missing from
   * the directory, the tree does not place it, or the parents loop - yields `[]`
   * (publish uncategorised) rather than a truncated path, since a truncated path
   * is precisely what lands a category at the wrong level.
   *
   * Reads the product through the same translating read as `getProduct`, so a
   * product Shoper reports gone surfaces here as the neutral
   * `MasterProductNotFoundError` too - core may reach a deleted product through
   * this method first, and a plain `ShoperApiError` would miss the deletion.
   */
  async getProductCategories(productId: string): Promise<Category[]> {
    const externalId = await this.resolveExternalProductId(productId);
    const data = await this.readProduct(externalId, productId);
    const anchor = primaryShoperCategoryId(data);
    if (anchor === null) {
      return [];
    }

    return (await this.categoryPath(externalId, anchor)) ?? [];
  }

  /**
   * The categories from the root down to `anchor`, read off the memoised
   * directory (so a batch page pays for it once), or `null` when the path
   * cannot be completed: the anchor or an ancestor is missing from the
   * directory (an unnamed category is left out of it), the tree does not place
   * it, or the parents loop. Never a truncated path. Shared by the placement
   * path (`getProductCategories`) and the category breadcrumb.
   */
  private async categoryPath(externalId: string, anchor: string): Promise<Category[] | null> {
    const directory = new Map((await this.getCategories()).map((c) => [c.id, c]));
    const path: Category[] = [];
    const seen = new Set<string>();
    let currentId: string | undefined = anchor;
    while (currentId !== undefined) {
      const category = directory.get(currentId);
      const gap =
        category === undefined
          ? 'not in the directory'
          : category.depth === undefined
            ? 'not placed in the tree'
            : seen.has(currentId)
              ? 'parents loop'
              : null;
      if (category === undefined || gap !== null) {
        this.logger.warn(
          `Shoper product ${externalId}: the path of category ${anchor} cannot be completed at ` +
            `${currentId} (${gap ?? 'unknown'}); returning no categories (connection: ${this.connection.id})`
        );
        return null;
      }
      seen.add(currentId);
      path.unshift(category);
      currentId = category.parentId;
    }
    return path;
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
      products.push(await this.withGpsr({ ...mapShoperProduct(raw, ctx), id: internalId }, raw));
    }
    return products;
  }

  /**
   * Attach the product's GPSR data when the shop reported any answer.
   * `undefined` (not reported, or not resolvable this time) adds no key, so
   * the stored declaration is left as it is.
   */
  private async withGpsr(product: Product, raw: ShoperProduct): Promise<Product> {
    const gpsr = await this.gpsrReader.resolve(raw.safety_information, String(raw.product_id));
    return gpsr === undefined ? product : { ...product, gpsr };
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
   * Walked by `categoryPath` over the same memoised directory the placement
   * path reads, so a batch page reads the directory once rather than once per
   * product. Best-effort like the gallery: a failure, including a tree Shoper
   * answered unreadably, is logged and the product syncs without a path.
   */
  private async readCategoryBreadcrumb(
    data: ShoperProduct,
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
      const path = await this.categoryPath(String(data.product_id), leafId);
      return path === null ? null : path.map((category) => ({ id: category.id, name: category.name }));
    } catch (error) {
      this.logger.warn(
        `Shoper category path of product ${data.product_id} could not be read; syncing without it ` +
          `(${error instanceof Error ? error.message : String(error)}, connection: ${this.connection.id})`,
      );
      return null;
    }
  }

  private fetchAllStocks(externalProductId: string): Promise<ShoperStock[]> {
    const warmed = this.stockCache.get(externalProductId);
    if (warmed !== undefined) {
      return Promise.resolve([...warmed]);
    }
    // The filter-ignored guard lives in `fetchShoperStocks`; this only reports it.
    return fetchShoperStocks(this.client, externalProductId, (count) =>
      this.logger.warn(
        `Shoper returned ${count} stock row(s) of another product while reading product ` +
          `${externalProductId}; dropped (connection: ${this.connection.id})`,
      ),
    );
  }
}
