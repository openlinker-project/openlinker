/**
 * Shopify Product Master Adapter
 *
 * Implements `ProductMasterPort` over the Admin GraphQL API (2026-10) - the
 * READ side: `getProduct`, `getProducts`, `getProductVariants`,
 * `searchProducts`, `listExternalIds`, `getProductCategories` and
 * `getCategories`. Every write throws `ShopifyNotSupportedException` (a silent
 * no-op would read as "done").
 *
 * Also implements three guard-only rungs (ADR-048 / ADR-063), never advertised
 * in the manifest:
 *   - `ModifiedProductLister` - the UNION of products and variants whose
 *     `updated_at` moved since the watermark. A stock change bumps both, but a
 *     variant price edit bumps ONLY the variant (L-M2). Both reads go through
 *     the search index, which lags a write by 5-10 s, and Shopify's clock ran
 *     14 s behind OpenLinker's watermark (A19), so the window is pulled back a
 *     further 15 s on top of the caller's lookback.
 *   - `BulkProductReader` - a prefetch that hydrates a batch with `nodes(ids:)`.
 *   - `ProductTaxRateReader` - computed through `draftOrderCalculate`
 *     (`ShopifyTaxRateReader`); product-keyed, the first variant answers.
 *
 * Ids: methods taking a product id take the INTERNAL one and resolve the
 * Shopify id through the identifier mapping; `listExternalIds` and
 * `filters.externalIds` speak Shopify's numeric ids.
 *
 * What the catalogue leaves out (decisions on #3975):
 *   - ARCHIVED products: withdrawn from sale. Left out of `listExternalIds`;
 *     a direct read answers `MasterProductNotFoundError` (`ShopifyProductReader`).
 *     DRAFT and UNLISTED products sync normally.
 *   - Gift cards: not a physical product, redeemable only at Shopify checkout.
 *     Left out of the enumeration, the delta pass and the category directory.
 *
 * Category (A15): the Standard Product Taxonomy category, one per product.
 * `getCategories` returns the shop's DIRECTORY - the nodes its products sit in
 * plus their ancestors - so the master's category-mapping page lists what the
 * operator sells instead of the whole taxonomy. Collections are not the master
 * category: a product can sit in many or none, so a mapping lookup over them
 * would have no "most specific" answer.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/product-master
 * @implements {ProductMasterPort}
 */
import type {
  BulkProductReader,
  Category,
  ListExternalIdsModifiedSinceInput,
  ModifiedProductLister,
  Product,
  ProductCreate,
  ProductFilters,
  ProductMasterPort,
  ProductTaxRateReader,
  ProductUpdate,
  ProductVariant,
  ProductVariantCreate,
  ReadProductTaxRateInput,
  TaxRateResolution,
} from '@openlinker/core/products';
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import type { CachePort } from '@openlinker/shared';
import { Logger } from '@openlinker/shared/logging';

import { ShopifyNotSupportedException } from '../../../domain/exceptions/shopify-not-supported.exception';
import { fromShopifyGid, toShopifyGid } from '../../../domain/policies/shopify-gid.policy';
import type {
  ShopifyConnection,
  ShopifyProduct,
  ShopifyTaxonomyCategory,
} from '../../../domain/types/shopify-api.types';
import type { ShopifyGraphqlClient } from '../../http/shopify-graphql-client';
import {
  mapShopifyProduct,
  mapShopifyVariant,
  shopifyGrossFactor,
  shopifyCategoryDirectory,
  shopifyCategoryPath,
} from '../../mappers/shopify-product.mapper';
import { ShopifyBatchSizer } from '../../readers/shopify-cost-backoff';
import { resolveShopifyExternalId } from '../../readers/shopify-external-id';
import { ShopifyIdPager } from '../../readers/shopify-id-pager';
import {
  MODIFIED_PRODUCT_IDS_QUERY,
  MODIFIED_VARIANT_PRODUCT_IDS_QUERY,
  PRODUCT_CATEGORIES_PAGE_QUERY,
  PRODUCT_IDS_PAGE_QUERY,
  PRODUCTS_BY_IDS_QUERY,
  PRODUCTS_PAGE_QUERY,
  SHOPIFY_ID_PAGE_SIZE,
  SHOPIFY_PRODUCT_BATCH_SIZE,
} from '../../readers/shopify-product.queries';
import { isShopifyProductWithdrawn, type ShopifyProductReader } from '../../readers/shopify-product.reader';
import type {
  ShopifyShopContext,
  ShopifyShopContextProvider,
} from '../../shop-context/shopify-shop-context.provider';
import type { ShopifyTaxRateReader } from '../../tax/shopify-tax-rate.reader';

const DEFAULT_WINDOW = 50;
const NUMERIC_ID = /^\d+$/;
/** 40 x 250 = 10 000 products read for the category directory; past that it is partial and warned. */
const CATEGORY_SCAN_MAX_PAGES = 40;
/** Extra pull-back of a modified-since window: index lag plus the clock gap seen live (A19, L-M2). */
const MODIFIED_SINCE_PULL_BACK_MS = 15_000;
/** 80 x 250 = 20 000 changed rows per read; past that the window is partial and warned about. */
const MODIFIED_SCAN_MAX_PAGES = 80;
/** A delta cycle re-asks with the same `since` on every tick; its id list is reused for this long. */
const MODIFIED_IDS_CACHE_SECONDS = 3_600;

interface IdPageNode {
  readonly id: string;
  readonly status: string;
  readonly isGiftCard: boolean;
}

export class ShopifyProductMasterAdapter
  implements ProductMasterPort, ModifiedProductLister, BulkProductReader, ProductTaxRateReader
{
  private readonly logger = new Logger(ShopifyProductMasterAdapter.name);
  private readonly pager: ShopifyIdPager;
  private readonly batchSizer = new ShopifyBatchSizer(SHOPIFY_PRODUCT_BATCH_SIZE);

  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly shopContext: ShopifyShopContextProvider,
    private readonly productReader: ShopifyProductReader,
    private readonly taxRates: ShopifyTaxRateReader,
    private readonly connection: Connection,
    private readonly cache: CachePort | undefined,
  ) {
    this.pager = new ShopifyIdPager(client, cache, connection.id);
  }

  // ─── Enumeration ───────────────────────────────────────────────────────────

  listExternalIds(filters?: { limit?: number; offset?: number }): Promise<string[]> {
    return this.pager.window<IdPageNode>(
      {
        kind: 'catalogue',
        document: PRODUCT_IDS_PAGE_QUERY,
        pageSize: SHOPIFY_ID_PAGE_SIZE,
        field: 'products',
        idOf: (node) =>
          node.isGiftCard || isShopifyProductWithdrawn(node) ? null : fromShopifyGid(node.id),
      },
      filters?.offset ?? 0,
      filters?.limit ?? DEFAULT_WINDOW,
    );
  }

  /**
   * Product ids changed at or after `since` (see the header), ordered by
   * numeric id so a product re-edited mid-cycle does not move. Two searches
   * have no common cursor, so the whole union is read and sliced; a cycle asks
   * again with the same `since` on every tick (ADR-048 decision 3), so the
   * union is kept in the host cache for the cycle.
   */
  async listExternalIdsModifiedSince(input: ListExternalIdsModifiedSinceInput): Promise<string[]> {
    const from = new Date(input.since.getTime() - MODIFIED_SINCE_PULL_BACK_MS)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');
    const ids = await this.modifiedIds(from);
    return ids.slice(input.offset, input.offset + input.limit);
  }

  private async modifiedIds(from: string): Promise<string[]> {
    const key = `shopify:modified-ids:${this.connection.id}:${from}`;
    if (this.cache !== undefined) {
      const cached = await this.cache.get<string[]>(key).catch(() => null);
      if (Array.isArray(cached)) {
        return cached;
      }
    }
    const query = `updated_at:>='${from}' AND gift_card:false`;
    const [productIds, variantProductIds] = await Promise.all([
      this.readModifiedIds<{ id: string }>(MODIFIED_PRODUCT_IDS_QUERY, query, (n) => n.id),
      this.readModifiedIds<{ product: { id: string } | null }>(
        MODIFIED_VARIANT_PRODUCT_IDS_QUERY,
        query,
        (n) => n.product?.id ?? null,
      ),
    ]);
    const ids = [...new Set([...productIds, ...variantProductIds].map(fromShopifyGid))]
      .filter((id) => NUMERIC_ID.test(id))
      .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
    if (this.cache !== undefined) {
      await this.cache.set(key, ids, MODIFIED_IDS_CACHE_SECONDS).catch(() => undefined);
    }
    return ids;
  }

  private async readModifiedIds<N>(
    document: string,
    query: string,
    productGidOf: (node: N) => string | null,
  ): Promise<string[]> {
    const gids: string[] = [];
    let after: string | null = null;
    for (let page = 0; page < MODIFIED_SCAN_MAX_PAGES; page += 1) {
      const data: Record<string, ShopifyConnection<N>> = await this.client.query(document, {
        first: SHOPIFY_ID_PAGE_SIZE,
        after,
        query,
      });
      const connection = Object.values(data)[0];
      for (const node of connection?.nodes ?? []) {
        const gid = productGidOf(node);
        if (gid !== null) {
          gids.push(gid);
        }
      }
      if (connection?.pageInfo?.hasNextPage !== true || connection.pageInfo.endCursor === null) {
        return gids;
      }
      after = connection.pageInfo.endCursor;
    }
    this.logger.warn(
      `Shopify modified-since read stopped after ${MODIFIED_SCAN_MAX_PAGES * SHOPIFY_ID_PAGE_SIZE} rows; ` +
        `the full catalogue pass picks up the rest (connection: ${this.connection.id})`,
    );
    return gids;
  }

  // ─── Bulk prefetch ─────────────────────────────────────────────────────────

  /**
   * Warms the reader for a batch with `nodes(ids:)`, sized down on a cost
   * refusal. Best effort: a failure leaves each product to its own read, and an
   * id Shopify no longer has is simply not warmed (its per-product read raises
   * the deletion signal, never this path).
   */
  async prefetchProducts(externalIds: readonly string[]): Promise<void> {
    try {
      const products = await this.readByExternalIds(externalIds);
      for (const product of products) {
        this.productReader.seed(fromShopifyGid(product.id), product);
      }
      if (products.length > 0) {
        await this.shopContext.get();
      }
    } catch (error) {
      this.logger.warn(
        `Shopify bulk product prefetch failed for ${externalIds.length} product(s) ` +
          `(connection: ${this.connection.id}); falling back to per-product reads: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ─── Reads ─────────────────────────────────────────────────────────────────

  async getProduct(productId: string): Promise<Product> {
    const raw = await this.readByInternalId(productId);
    const ctx = await this.shopContext.get();
    return { ...mapShopifyProduct(raw, ctx, await this.grossFactorFor(raw, ctx)), id: productId };
  }

  async getProducts(filters?: ProductFilters): Promise<Product[]> {
    if (filters?.categoryIds !== undefined && filters.categoryIds.length > 0) {
      throw new ShopifyNotSupportedException('getProducts filter "categoryIds"');
    }
    if (filters?.status !== undefined) {
      throw new ShopifyNotSupportedException('getProducts filter "status"');
    }
    if (filters?.externalIds !== undefined) {
      const products = await this.readByExternalIds(filters.externalIds);
      return this.toProducts(products.filter((p) => !isShopifyProductWithdrawn(p)));
    }
    const search = filters?.query?.trim();
    const rows = await this.readWindow(
      filters?.offset ?? 0,
      filters?.limit ?? DEFAULT_WINDOW,
      search === undefined || search.length === 0 ? null : `title:*${search.replace(/["\\*]/g, '')}*`,
    );
    return this.toProducts(rows);
  }

  async getProductVariants(productId: string): Promise<ProductVariant[]> {
    const raw = await this.readByInternalId(productId);
    const ctx = await this.shopContext.get();
    const variants = raw.variants.nodes;
    if (variants.length === 0) {
      return [];
    }
    const grossFactor = await this.grossFactorFor(raw, ctx);

    const idMap = await this.identifierMapping.batchGetOrCreateInternalIds(
      variants.map((v) => {
        const variantExternalId = fromShopifyGid(v.id);
        return {
          entityType: CORE_ENTITY_TYPE.ProductVariant,
          externalId: variantExternalId,
          connectionId: this.connection.id,
          context: {
            parentEntityType: CORE_ENTITY_TYPE.Product,
            parentInternalId: productId,
            metadata: { variantExternalId },
          },
        };
      }),
    );

    const result: ProductVariant[] = [];
    for (const variant of variants) {
      const internalId = idMap.get(`${fromShopifyGid(variant.id)}:${this.connection.id}`);
      if (internalId === undefined) {
        this.logger.warn(`No internal id for Shopify variant ${variant.id} (connection: ${this.connection.id})`);
        continue;
      }
      result.push({ ...mapShopifyVariant(variant, productId, ctx, grossFactor), id: internalId });
    }
    return result;
  }

  searchProducts(query: string, filters?: ProductFilters): Promise<Product[]> {
    return this.getProducts({ ...filters, query });
  }

  /**
   * The product's taxonomy path, root to leaf. Reads through the shared
   * reader, so a deleted product surfaces here as the neutral not-found error
   * too - core may reach a deleted product through this method first.
   */
  async getProductCategories(productId: string): Promise<Category[]> {
    const raw = await this.readByInternalId(productId);
    return shopifyCategoryPath(raw.category);
  }

  /**
   * The shop's category directory (flat, `parentId` + `depth`), served live to
   * the master's category-mapping page. One cheap paged read of every
   * product's category; a category with no product yet is not listed, which
   * costs nothing - no product can resolve through it.
   */
  async getCategories(): Promise<Category[]> {
    const categories: Array<ShopifyTaxonomyCategory | null> = [];
    let after: string | null = null;
    for (let page = 0; page < CATEGORY_SCAN_MAX_PAGES; page += 1) {
      const data: {
        products: ShopifyConnection<{ isGiftCard: boolean; category: ShopifyTaxonomyCategory | null }>;
      } = await this.client.query(PRODUCT_CATEGORIES_PAGE_QUERY, { first: SHOPIFY_ID_PAGE_SIZE, after });
      categories.push(...data.products.nodes.filter((p) => !p.isGiftCard).map((p) => p.category));
      if (data.products.pageInfo?.hasNextPage !== true || data.products.pageInfo.endCursor === null) {
        return shopifyCategoryDirectory(categories);
      }
      after = data.products.pageInfo.endCursor;
    }
    this.logger.warn(
      `Shopify category directory read stopped after ${CATEGORY_SCAN_MAX_PAGES * SHOPIFY_ID_PAGE_SIZE} products; ` +
        `categories only used by later products are missing (connection: ${this.connection.id})`,
    );
    return shopifyCategoryDirectory(categories);
  }

  // ─── Tax rate ──────────────────────────────────────────────────────────────

  /**
   * The rate Shopify would charge for the product in the sales country. Keyed
   * on the product: a collection override applies to the whole product, so
   * its first variant answers (`readsTaxRatePerVariant` is not declared).
   */
  async readProductTaxRate(input: ReadProductTaxRateInput): Promise<TaxRateResolution> {
    const raw = await this.readByInternalId(input.productId);
    const first = raw.variants.nodes[0];
    if (first === undefined) {
      return { kind: 'unknown', reason: 'unreadable', detail: 'the product has no variant' };
    }
    return this.taxRates.read({ variantId: first.id });
  }

  // ─── Not supported ─────────────────────────────────────────────────────────

  createProduct(_product: ProductCreate): Promise<Product> {
    return Promise.reject(new ShopifyNotSupportedException('createProduct'));
  }

  updateProduct(_productId: string, _product: ProductUpdate): Promise<Product> {
    return Promise.reject(new ShopifyNotSupportedException('updateProduct'));
  }

  deleteProduct(_productId: string): Promise<void> {
    return Promise.reject(new ShopifyNotSupportedException('deleteProduct'));
  }

  upsertProductVariant(_productId: string, _variant: ProductVariantCreate): Promise<ProductVariant> {
    return Promise.reject(new ShopifyNotSupportedException('upsertProductVariant'));
  }

  assignCategories(_productId: string, _categoryIds: string[]): Promise<void> {
    return Promise.reject(new ShopifyNotSupportedException('assignCategories'));
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /**
   * The factor a tax-exclusive shop's net prices are grossed up with (ADR-077):
   * the rate Shopify computes for the product's first variant in the sales
   * country, one rate per product like `readProductTaxRate`. Null on a
   * tax-inclusive shop (nothing to convert) and when the rate is unknown, which
   * leaves the price absent. A transport failure throws, so the sync retries
   * rather than storing a product without its price.
   */
  private async grossFactorFor(raw: ShopifyProduct, ctx: ShopifyShopContext): Promise<number | null> {
    const first = raw.variants.nodes[0];
    if (ctx.taxesIncluded || first === undefined) {
      return null;
    }
    return shopifyGrossFactor(await this.taxRates.read({ variantId: first.id }));
  }

  private async readByInternalId(productId: string): Promise<ShopifyProduct> {
    const externalId = await resolveShopifyExternalId(
      this.identifierMapping,
      this.connection.id,
      CORE_ENTITY_TYPE.Product,
      productId,
    );
    return this.productReader.read(externalId, productId);
  }

  /**
   * `nodes(ids:)` answers null for an id that names nothing, so an absent
   * product is simply absent from the result - deletion is reported by the
   * per-product read, never inferred here.
   */
  private async readByExternalIds(externalIds: readonly string[]): Promise<ShopifyProduct[]> {
    const valid = [...new Set(externalIds.map(String))].filter((id) => NUMERIC_ID.test(id));
    if (valid.length < externalIds.length) {
      this.logger.warn(
        `Ignoring ${externalIds.length - valid.length} non-numeric or repeated product id(s) ` +
          `(connection: ${this.connection.id})`,
      );
    }
    const products: ShopifyProduct[] = [];
    let position = 0;
    while (position < valid.length) {
      const chunk = await this.batchSizer.run(async (size) => {
        const ids = valid.slice(position, position + size);
        const data = await this.client.query<{ nodes: ReadonlyArray<ShopifyProduct | null> }>(
          PRODUCTS_BY_IDS_QUERY,
          { ids: ids.map((id) => toShopifyGid('Product', id)) },
        );
        return { count: ids.length, nodes: data.nodes };
      });
      for (const node of chunk.nodes) {
        // A node of another type answers `{}` through the inline fragment; skip it.
        if (node !== null && typeof node.id === 'string') {
          products.push(node);
        }
      }
      position += chunk.count;
    }
    return products;
  }

  /** An operator's list or search window: walked from the start (no sweep calls this). */
  private async readWindow(offset: number, limit: number, search: string | null): Promise<ShopifyProduct[]> {
    const rows: ShopifyProduct[] = [];
    let after: string | null = null;
    while (rows.length < offset + limit) {
      const page = await this.batchSizer.run((size) =>
        this.client.query<{ products: ShopifyConnection<ShopifyProduct> }>(PRODUCTS_PAGE_QUERY, {
          first: size,
          after,
          query: search,
        }),
      );
      rows.push(...page.products.nodes.filter((p) => !p.isGiftCard && !isShopifyProductWithdrawn(p)));
      if (page.products.pageInfo?.hasNextPage !== true || page.products.pageInfo.endCursor === null) {
        break;
      }
      after = page.products.pageInfo.endCursor;
    }
    return rows.slice(offset, offset + limit);
  }

  private async toProducts(items: readonly ShopifyProduct[]): Promise<Product[]> {
    if (items.length === 0) {
      return [];
    }
    const ctx = await this.shopContext.get();
    const idMap = await this.identifierMapping.batchGetOrCreateInternalIds(
      items.map((p) => ({
        entityType: CORE_ENTITY_TYPE.Product,
        externalId: fromShopifyGid(p.id),
        connectionId: this.connection.id,
      })),
    );
    const products: Product[] = [];
    for (const raw of items) {
      const externalId = fromShopifyGid(raw.id);
      const internalId = idMap.get(`${externalId}:${this.connection.id}`);
      if (internalId === undefined) {
        this.logger.warn(`No internal id for Shopify product ${externalId} (connection: ${this.connection.id})`);
        continue;
      }
      // Later per-product reads in this resolution are served from memory.
      this.productReader.seed(externalId, raw);
      products.push({ ...mapShopifyProduct(raw, ctx, await this.grossFactorFor(raw, ctx)), id: internalId });
    }
    return products;
  }
}
