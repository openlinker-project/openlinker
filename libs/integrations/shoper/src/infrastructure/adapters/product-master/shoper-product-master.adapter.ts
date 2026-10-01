/**
 * Shoper Product Master Adapter
 *
 * Implements `ProductMasterPort` over Shoper's REST API - the READ side:
 * `getProduct`, `getProducts`, `getProductVariants`, `searchProducts` and
 * `listExternalIds`. Every write, and the category reads, throw
 * `ShoperNotSupportedException` (an empty result would read as "no categories"
 * rather than "not implemented"); the category reads arrive with their own
 * milestone task.
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
 * larger one to 10. This adapter never sends more than 50 and refuses a larger
 * request, and refuses an `offset` that is not a multiple of `limit` rather
 * than returning a shifted window (see `shoper-pagination.ts`).
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
} from '@openlinker/core/products';
import type { IdentifierMappingPort, Connection } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';

import { ShoperNotMappedException } from '../../../domain/exceptions/shoper-not-mapped.exception';
import { ShoperNotSupportedException } from '../../../domain/exceptions/shoper-not-supported.exception';
import type { ShoperProduct, ShoperStock } from '../../../domain/types/shoper-api.types';
import type { ShoperHttpClient, ShoperQuery } from '../../http/shoper-http-client';
import {
  SHOPER_MAX_PAGE_SIZE,
  assertShoperPageSize,
  fetchShoperPage,
} from '../../http/shoper-pagination';
import {
  mapShoperProduct,
  mapShoperStockToVariant,
} from '../../mappers/shoper-product.mapper';
import type { ShoperShopContextProvider } from '../../shop-context/shoper-shop-context.provider';

/** Explicit direction: a bare `order=<field>` sorts DESCENDING on Shoper. */
const PRODUCT_ORDER = 'product_id ASC';

export class ShoperProductMasterAdapter implements ProductMasterPort {
  private readonly logger = new Logger(ShoperProductMasterAdapter.name);

  constructor(
    private readonly client: ShoperHttpClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly shopContext: ShoperShopContextProvider,
    private readonly connection: Connection,
  ) {}

  // ─── Read methods ──────────────────────────────────────────────────────────

  async listExternalIds(filters?: { limit?: number; offset?: number }): Promise<string[]> {
    const { limit, page } = this.resolvePaging(filters, 'listExternalIds');
    const result = await fetchShoperPage<Pick<ShoperProduct, 'product_id'>>(
      this.client,
      '/products',
      { page, limit, query: { order: PRODUCT_ORDER } },
    );
    return result.items.map((p) => p.product_id);
  }

  async getProduct(productId: string): Promise<Product> {
    const externalId = await this.resolveExternalProductId(productId);
    const { data } = await this.client.get<ShoperProduct>(`/products/${externalId}`);
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

    const { limit, page } = this.resolvePaging(filters, 'getProducts');
    if (where !== null) {
      query.filters = JSON.stringify(where);
    }
    const result = await fetchShoperPage<ShoperProduct>(this.client, '/products', {
      page,
      limit,
      query,
    });
    return this.toProducts(result.items);
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

  getProductCategories(_productId: string): Promise<Category[]> {
    return Promise.reject(new ShoperNotSupportedException('getProductCategories'));
  }

  assignCategories(_productId: string, _categoryIds: string[]): Promise<void> {
    return Promise.reject(new ShoperNotSupportedException('assignCategories'));
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

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
   * `offset` -> page. Shoper pages by index, so an offset that is not a whole
   * number of pages cannot be expressed; it is refused, never rounded.
   */
  private resolvePaging(
    filters: { limit?: number; offset?: number } | undefined,
    operation: string,
  ): { limit: number; page: number } {
    const limit = filters?.limit ?? SHOPER_MAX_PAGE_SIZE;
    assertShoperPageSize(limit, operation);
    const offset = filters?.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || offset % limit !== 0) {
      throw new RangeError(
        `Shoper ${operation}: offset ${offset} is not a multiple of the page size ${limit}; ` +
          'Shoper pages by page index and cannot return a shifted window',
      );
    }
    return { limit, page: offset / limit + 1 };
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

  private async getProductsByExternalIds(
    externalIds: readonly string[],
    where: Record<string, unknown> | null,
  ): Promise<Product[]> {
    const products: Product[] = [];
    for (let i = 0; i < externalIds.length; i += SHOPER_MAX_PAGE_SIZE) {
      const chunk = externalIds.slice(i, i + SHOPER_MAX_PAGE_SIZE);
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
      stocks.push(...result.items);
      if (page >= result.pages) {
        return stocks;
      }
      page += 1;
    }
  }
}
