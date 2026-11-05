/**
 * Shopify Product Master Adapter
 *
 * Implements `ProductMasterPort` over the Admin GraphQL API - the READ side:
 * `getProduct`, `getProducts`, `getProductVariants`, `searchProducts`,
 * `listExternalIds`, `getProductCategories` and `getCategories`. Every write throws
 * `ShopifyNotSupportedException` (a silent no-op would read as "done").
 *
 * Ids: methods taking a product id take the INTERNAL one and resolve the
 * Shopify id through the identifier mapping; `listExternalIds` and
 * `filters.externalIds` speak Shopify's numeric ids (see `shopify-gid.policy`).
 *
 * Paging: GraphQL pages by opaque cursor and has no offset, so a caller's
 * `{limit, offset}` window is walked from the start in pages of 250 ids
 * (`listExternalIds`) or 50 products. That is O(offset) per call, which a
 * prototype accepts; a production adapter would keep the cursor between ticks.
 *
 * Not implemented, deliberately:
 *   - `ProductTaxRateReader`: no tax rate exists anywhere in the Admin API
 *     (L-T2), so a Shopify master cannot state a catalogue rate.
 *
 * Modified-since rung (case A12, `ModifiedProductLister`, guard-only): the
 * UNION of products whose `updated_at` and variants whose `updated_at` moved
 * since the watermark, as product ids. Both are needed: a stock change bumps the
 * product and the variant, but a variant price edit bumps ONLY the variant
 * (L-M2). Both reads go through the search index, which lags a write by 5-10 s,
 * so the window is pulled back a further 15 s on top of the caller's lookback.
 * Ordered by numeric product id, so a product re-edited mid-cycle does not move;
 * the full pass stays the backstop for a deletion shifting the offsets.
 *
 * Category (case A15): the Standard Product Taxonomy category, one per product,
 * keyed by the tail of its GID (`hg-11-10-5-5`). `getCategories` returns the
 * shop's DIRECTORY - the nodes its products sit in plus their ancestors - so
 * the master's category-mapping page lists what the operator actually sells
 * instead of the whole global taxonomy (thousands of nodes). Collections are
 * NOT the master category: a product can sit in many (or none), they are
 * shop-defined and unordered, so a mapping lookup over them would have no
 * "most specific" answer. They stay the publish-side category (`CategoryProvisioner`).
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/product-master
 * @implements {ProductMasterPort}
 */
import type {
  Category,
  ListExternalIdsModifiedSinceInput,
  ModifiedProductLister,
  Product,
  ProductCreate,
  ProductFilters,
  ProductMasterPort,
  ProductUpdate,
  ProductVariant,
  ProductVariantCreate,
} from '@openlinker/core/products';
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
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
  shopifyCategoryDirectory,
  shopifyCategoryPath,
} from '../../mappers/shopify-product.mapper';
import { resolveShopifyExternalId } from '../../readers/shopify-external-id';
import {
  MODIFIED_PRODUCT_IDS_QUERY,
  MODIFIED_VARIANT_PRODUCT_IDS_QUERY,
  PRODUCT_CATEGORIES_PAGE_QUERY,
  PRODUCT_IDS_PAGE_QUERY,
  PRODUCTS_BY_IDS_QUERY,
  PRODUCTS_PAGE_QUERY,
} from '../../readers/shopify-product.queries';
import type { ShopifyProductReader } from '../../readers/shopify-product.reader';
import type { ShopifyShopContextProvider } from '../../shop-context/shopify-shop-context.provider';

const ID_PAGE_SIZE = 250;
const PRODUCT_PAGE_SIZE = 50;
const NODES_CHUNK = 100;
const DEFAULT_WINDOW = PRODUCT_PAGE_SIZE;
const NUMERIC_ID = /^\d+$/;
/** 40 x 250 = 10 000 products read for the category directory; past that it is partial and warned. */
const CATEGORY_SCAN_MAX_PAGES = 40;
/** Extra pull-back of a modified-since window: the search index lags a write by 5-10 s (L-M2). */
const SEARCH_INDEX_LAG_MS = 15_000;
/** 80 x 250 = 20 000 changed rows per read; past that the window is partial and warned about. */
const MODIFIED_SCAN_MAX_PAGES = 80;

export class ShopifyProductMasterAdapter implements ProductMasterPort, ModifiedProductLister {
  private readonly logger = new Logger(ShopifyProductMasterAdapter.name);

  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly shopContext: ShopifyShopContextProvider,
    private readonly productReader: ShopifyProductReader,
    private readonly connection: Connection,
  ) {}

  // ─── Read methods ──────────────────────────────────────────────────────────

  async listExternalIds(filters?: { limit?: number; offset?: number }): Promise<string[]> {
    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? DEFAULT_WINDOW;
    const ids: string[] = [];
    let after: string | null = null;
    while (ids.length < offset + limit) {
      const data: { products: ShopifyConnection<{ id: string }> } = await this.client.query(
        PRODUCT_IDS_PAGE_QUERY,
        { first: ID_PAGE_SIZE, after },
      );
      ids.push(...data.products.nodes.map((p) => fromShopifyGid(p.id)));
      if (data.products.pageInfo?.hasNextPage !== true) {
        break;
      }
      after = data.products.pageInfo.endCursor;
    }
    return ids.slice(offset, offset + limit);
  }

  /**
   * Product ids changed at or after `since` (see the header). The whole union
   * is read on every call and then sliced, because two searches have no common
   * cursor; a prototype accepts that cost.
   */
  async listExternalIdsModifiedSince(input: ListExternalIdsModifiedSinceInput): Promise<string[]> {
    const from = new Date(input.since.getTime() - SEARCH_INDEX_LAG_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const query = `updated_at:>='${from}'`;
    const [productIds, variantProductIds] = await Promise.all([
      this.readModifiedIds<{ id: string }>(MODIFIED_PRODUCT_IDS_QUERY, query, (n) => n.id),
      this.readModifiedIds<{ product: { id: string } | null }>(
        MODIFIED_VARIANT_PRODUCT_IDS_QUERY,
        query,
        (n) => n.product?.id ?? null,
      ),
    ]);
    const ids = [...new Set([...productIds, ...variantProductIds].map(fromShopifyGid))].sort(
      (a, b) => Number(a) - Number(b),
    );
    return ids.slice(input.offset, input.offset + input.limit);
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
        first: ID_PAGE_SIZE,
        after,
        query,
      });
      const connection = Object.values(data)[0];
      for (const node of connection.nodes) {
        const gid = productGidOf(node);
        if (gid !== null) {
          gids.push(gid);
        }
      }
      if (connection.pageInfo?.hasNextPage !== true) {
        return gids;
      }
      after = connection.pageInfo.endCursor;
    }
    this.logger.warn(
      `Shopify modified-since read stopped after ${MODIFIED_SCAN_MAX_PAGES * ID_PAGE_SIZE} rows; ` +
        `the full catalogue pass picks up the rest (connection: ${this.connection.id})`,
    );
    return gids;
  }

  async getProduct(productId: string): Promise<Product> {
    const externalId = await this.resolveExternalProductId(productId);
    const raw = await this.productReader.read(externalId, productId);
    const ctx = await this.shopContext.get();
    this.warnOnTruncatedVariants(raw);
    return { ...mapShopifyProduct(raw, ctx), id: productId };
  }

  async getProducts(filters?: ProductFilters): Promise<Product[]> {
    if (filters?.categoryIds !== undefined && filters.categoryIds.length > 0) {
      throw new ShopifyNotSupportedException('getProducts filter "categoryIds"');
    }
    if (filters?.status !== undefined) {
      throw new ShopifyNotSupportedException('getProducts filter "status"');
    }
    if (filters?.externalIds !== undefined) {
      return this.toProducts(await this.readByExternalIds(filters.externalIds));
    }
    const search = filters?.query?.trim();
    const rows = await this.readWindow(
      filters?.offset ?? 0,
      filters?.limit ?? DEFAULT_WINDOW,
      search === undefined || search.length === 0 ? null : `title:*${search.replace(/["\\]/g, '')}*`,
    );
    return this.toProducts(rows);
  }

  async getProductVariants(productId: string): Promise<ProductVariant[]> {
    const externalId = await this.resolveExternalProductId(productId);
    const raw = await this.productReader.read(externalId, productId);
    const ctx = await this.shopContext.get();
    this.warnOnTruncatedVariants(raw);
    const variants = raw.variants.nodes;
    if (variants.length === 0) {
      return [];
    }

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
        this.logger.warn(`No internal id for Shopify variant ${variant.id}`);
        continue;
      }
      result.push({ ...mapShopifyVariant(variant, productId, ctx), id: internalId });
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
    const externalId = await this.resolveExternalProductId(productId);
    const raw = await this.productReader.read(externalId, productId);
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
      const data: { products: ShopifyConnection<{ category: ShopifyTaxonomyCategory | null }> } =
        await this.client.query(PRODUCT_CATEGORIES_PAGE_QUERY, { first: ID_PAGE_SIZE, after });
      categories.push(...data.products.nodes.map((p) => p.category));
      if (data.products.pageInfo?.hasNextPage !== true) {
        return shopifyCategoryDirectory(categories);
      }
      after = data.products.pageInfo.endCursor;
    }
    this.logger.warn(
      `Shopify category directory read stopped after ${CATEGORY_SCAN_MAX_PAGES * ID_PAGE_SIZE} products; ` +
        `categories only used by later products are missing (connection: ${this.connection.id})`,
    );
    return shopifyCategoryDirectory(categories);
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

  private resolveExternalProductId(productId: string): Promise<string> {
    return resolveShopifyExternalId(
      this.identifierMapping,
      this.connection.id,
      CORE_ENTITY_TYPE.Product,
      productId,
    );
  }

  /**
   * `nodes(ids:)` answers null for an id that names nothing, so an absent
   * product is simply absent from the result - deletion is reported by
   * `getProduct`, never inferred here.
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
    for (let i = 0; i < valid.length; i += NODES_CHUNK) {
      const chunk = valid.slice(i, i + NODES_CHUNK).map((id) => toShopifyGid('Product', id));
      const data = await this.client.query<{ nodes: ReadonlyArray<ShopifyProduct | null> }>(
        PRODUCTS_BY_IDS_QUERY,
        { ids: chunk },
      );
      for (const node of data.nodes) {
        // A non-product node answers `{}` through the inline fragment; skip it.
        if (node !== null && typeof node.id === 'string') {
          products.push(node);
        }
      }
    }
    return products;
  }

  private async readWindow(offset: number, limit: number, search: string | null): Promise<ShopifyProduct[]> {
    const rows: ShopifyProduct[] = [];
    let after: string | null = null;
    while (rows.length < offset + limit) {
      const data: { products: ShopifyConnection<ShopifyProduct> } = await this.client.query(
        PRODUCTS_PAGE_QUERY,
        { first: PRODUCT_PAGE_SIZE, after, query: search },
      );
      rows.push(...data.products.nodes);
      if (data.products.pageInfo?.hasNextPage !== true) {
        break;
      }
      after = data.products.pageInfo.endCursor;
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
        this.logger.warn(`No internal id for Shopify product ${externalId}`);
        continue;
      }
      // Later per-product reads in this resolution are served from memory.
      this.productReader.seed(externalId, raw);
      this.warnOnTruncatedVariants(raw);
      products.push({ ...mapShopifyProduct(raw, ctx), id: internalId });
    }
    return products;
  }

  private warnOnTruncatedVariants(raw: ShopifyProduct): void {
    if (raw.variants.pageInfo?.hasNextPage === true) {
      this.logger.warn(
        `Shopify product ${fromShopifyGid(raw.id)} has more variants than one page; ` +
          `only the first ${raw.variants.nodes.length} are synced (connection: ${this.connection.id})`,
      );
    }
  }
}
