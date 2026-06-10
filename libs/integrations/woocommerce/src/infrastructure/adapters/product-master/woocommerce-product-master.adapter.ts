/**
 * WooCommerce Product Master Adapter
 *
 * Implements the read half of ProductMasterPort for WooCommerce REST API v3.
 * Write methods (createProduct, updateProduct, deleteProduct,
 * upsertProductVariant, assignCategories) throw WooCommerceNotSupportedException
 * and are deferred to #879.
 *
 * Pagination: single-page fetch consistent with PrestashopProductMasterAdapter.
 * The caller (master-product-sync-all.handler.ts) drives the loop via
 * listExternalIds({ limit, offset }). Offset is translated to WC page numbers
 * using page = Math.floor(offset / perPage) + 1.
 *
 * 404 handling: WooCommerceHttpClient throws WooCommerceHttpResponseException(404)
 * for not-found responses. Adapter catches and rethrows as
 * WooCommerceResourceNotFoundException with full entity context (entityType,
 * OL internal ID, connectionId) — consistent with PrestashopResourceNotFoundException
 * at the PS adapter boundary.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/product-master
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
import type { IWooCommerceHttpClient } from '../../http/woocommerce-http-client.interface';
import { WooCommerceHttpResponseException } from '../../http/woocommerce-http-response.exception';
import type { IWooCommerceProductMapper } from '../../mappers/woocommerce-product.mapper.interface';
import { WooCommerceNotSupportedException } from '../../../domain/exceptions/woocommerce-not-supported.exception';
import { WooCommerceResourceNotFoundException } from '../../../domain/exceptions/woocommerce-resource-not-found.exception';
import type {
  WooCommerceProduct,
  WooCommerceProductVariation,
  WooCommerceProductCategory,
} from './woocommerce-product.types';

// Safety cap for fetchAllPages: 500 pages × 100 items = 50,000 items max.
// Mirrors the MAX_PAGES guard in master-product-sync-all.handler.ts.
const FETCH_ALL_MAX_PAGES = 500;

export class WooCommerceProductMasterAdapter implements ProductMasterPort {
  private readonly logger = new Logger(WooCommerceProductMasterAdapter.name);

  constructor(
    private readonly httpClient: IWooCommerceHttpClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly mapper: IWooCommerceProductMapper,
    private readonly connection: Connection,
  ) {}

  // ─── Internal pagination helper ───────────────────────────────────────────

  /**
   * Exhausts all WC REST API pages for a given path and returns a flat array.
   * Used only for methods whose contract is "return all" (getCategories, getProductVariants).
   * For externally-paged methods (listExternalIds, getProducts) the caller drives the loop.
   */
  private async fetchAllPages<T>(
    path: string,
    params?: Record<string, string | number | boolean>,
    perPage = 100,
  ): Promise<T[]> {
    const results: T[] = [];
    let page = 1;
    while (true) {
      this.logger.debug(
        `fetchAllPages: GET ${path} page=${page} per_page=${perPage} (connection: ${this.connection.id})`,
      );
      const batch = await this.httpClient.get<T[]>(path, { ...params, per_page: perPage, page });
      results.push(...batch);
      if (batch.length < perPage) break;
      if (page >= FETCH_ALL_MAX_PAGES) {
        this.logger.warn(
          `fetchAllPages: hit MAX_PAGES (${FETCH_ALL_MAX_PAGES}) for ${path} ` +
            `(connection: ${this.connection.id}) — catalog may be truncated`,
        );
        break;
      }
      page++;
    }
    return results;
  }

  // ─── Port methods ──────────────────────────────────────────────────────────

  async listExternalIds(filters?: { limit?: number; offset?: number }): Promise<string[]> {
    this.logger.debug(
      `Listing external product IDs (connection: ${this.connection.id}, limit: ${String(filters?.limit)}, offset: ${String(filters?.offset)})`,
    );
    const perPage = filters?.limit ?? 100;
    const page =
      filters?.offset !== undefined ? Math.floor(filters.offset / perPage) + 1 : 1;
    // WC uses page-based pagination: offset must be an exact multiple of perPage.
    // A non-multiple offset maps to the nearest lower page, silently returning
    // overlapping items. The current caller (master-product-sync-all.handler)
    // always passes clean multiples, but we warn here to surface misuse early.
    if (
      filters?.offset !== undefined &&
      perPage > 0 &&
      filters.offset % perPage !== 0
    ) {
      this.logger.warn(
        `listExternalIds: offset ${String(filters.offset)} is not a clean multiple of limit ${String(perPage)}; ` +
          `WC pagination is page-based — returning page ${String(page)} which may overlap with previous results`,
      );
    }
    const raw = await this.httpClient.get<Array<{ id: number }>>(
      '/wp-json/wc/v3/products',
      { _fields: 'id', per_page: perPage, page },
    );
    return raw
      .filter((r): r is { id: number } => r.id !== undefined && r.id !== null)
      .map((r) => String(r.id));
  }

  async getProduct(productId: string): Promise<Product> {
    this.logger.debug(`Getting product: ${productId} (connection: ${this.connection.id})`);
    const externalIds = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Product,
      productId,
    );
    const mapping = externalIds.find((e) => e.connectionId === this.connection.id);
    if (!mapping) {
      throw new WooCommerceResourceNotFoundException(
        `Product not found: ${productId} (no mapping for connection ${this.connection.id})`,
        CORE_ENTITY_TYPE.Product,
        productId,
        this.connection.id,
      );
    }
    let p: WooCommerceProduct;
    try {
      p = await this.httpClient.get<WooCommerceProduct>(
        `/wp-json/wc/v3/products/${mapping.externalId}`,
      );
    } catch (err) {
      if (err instanceof WooCommerceHttpResponseException && err.statusCode === 404) {
        throw new WooCommerceResourceNotFoundException(
          `WooCommerce product ${mapping.externalId} not found (deleted?)`,
          CORE_ENTITY_TYPE.Product,
          productId,
          this.connection.id,
        );
      }
      throw err;
    }
    return { ...this.mapper.mapProduct(p), id: productId };
  }

  async getProducts(filters?: ProductFilters): Promise<Product[]> {
    this.logger.debug(`Getting products with filters (connection: ${this.connection.id})`);
    const params = this.buildWcParams(filters);
    const products = await this.httpClient.get<WooCommerceProduct[]>(
      '/wp-json/wc/v3/products',
      params,
    );
    if (products.length === 0) return [];

    const validProducts = products.filter(
      (p): p is WooCommerceProduct & { id: number } => p.id !== undefined && p.id !== null,
    );

    const idMap = await this.identifierMapping.batchGetOrCreateInternalIds(
      validProducts.map((p) => ({
        entityType: CORE_ENTITY_TYPE.Product,
        externalId: String(p.id),
        connectionId: this.connection.id,
      })),
    );

    return validProducts
      .map((p) => {
        // batchGetOrCreateInternalIds keys its result Map by the composite
        // `${externalId}:${connectionId}`, not the bare external id.
        const internalId = idMap.get(`${String(p.id)}:${this.connection.id}`);
        if (!internalId) {
          this.logger.warn(`No internal ID for WC product ${String(p.id)}`);
          return null;
        }
        return { ...this.mapper.mapProduct(p), id: internalId };
      })
      .filter((p): p is Product => p !== null);
  }

  async getProductVariants(productId: string): Promise<ProductVariant[]> {
    this.logger.debug(
      `Getting variants for product: ${productId} (connection: ${this.connection.id})`,
    );
    const externalIds = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Product,
      productId,
    );
    const mapping = externalIds.find((e) => e.connectionId === this.connection.id);
    if (!mapping) {
      throw new WooCommerceResourceNotFoundException(
        `Product not found: ${productId}`,
        CORE_ENTITY_TYPE.Product,
        productId,
        this.connection.id,
      );
    }

    const wcId = mapping.externalId;
    let product: WooCommerceProduct;
    try {
      product = await this.httpClient.get<WooCommerceProduct>(
        `/wp-json/wc/v3/products/${wcId}`,
      );
    } catch (err) {
      if (err instanceof WooCommerceHttpResponseException && err.statusCode === 404) {
        throw new WooCommerceResourceNotFoundException(
          `WooCommerce product ${wcId} not found (deleted?)`,
          CORE_ENTITY_TYPE.Product,
          productId,
          this.connection.id,
        );
      }
      throw err;
    }

    if (product.type !== 'variable' || !product.variations?.length) {
      // Simple product — deterministic synthetic variant (same convention as PrestaShop)
      const syntheticExternalId = `product:${wcId}`;
      const internalVariantId = await this.identifierMapping.getOrCreateInternalId(
        CORE_ENTITY_TYPE.ProductVariant,
        syntheticExternalId,
        this.connection.id,
        {
          parentEntityType: CORE_ENTITY_TYPE.Product,
          parentInternalId: productId,
          metadata: { variantExternalId: syntheticExternalId, synthetic: true },
        },
      );
      const price =
        product.price !== undefined ? this.parseVariantPrice(product.price) : undefined;
      const metaData = product.meta_data ?? [];
      return [
        {
          id: internalVariantId,
          productId,
          sku: product.sku || `product-${wcId}`,
          attributes: null,
          ean: this.mapper.extractEan(metaData),
          gtin: this.mapper.extractGtin(metaData),
          price,
        },
      ];
    }

    // Variable product — delete stale synthetic (safe no-op if absent)
    try {
      await this.identifierMapping.deleteMapping(
        CORE_ENTITY_TYPE.ProductVariant,
        `product:${wcId}`,
        this.connection.id,
      );
    } catch (err) {
      this.logger.warn('Failed to delete stale synthetic variant', err);
      // Continue — variants fetch is more important than cleanup
    }

    // Exhaust all pages — products with >100 variations exist (configurable products, apparel).
    const variations = await this.fetchAllPages<WooCommerceProductVariation>(
      `/wp-json/wc/v3/products/${wcId}/variations`,
    );

    const validVariations = variations.filter(
      (v): v is WooCommerceProductVariation & { id: number } =>
        v.id !== undefined && v.id !== null,
    );

    const idMap = await this.identifierMapping.batchGetOrCreateInternalIds(
      validVariations.map((v) => ({
        entityType: CORE_ENTITY_TYPE.ProductVariant,
        externalId: String(v.id),
        connectionId: this.connection.id,
        context: {
          parentEntityType: CORE_ENTITY_TYPE.Product,
          parentInternalId: productId,
          metadata: { variantExternalId: String(v.id) },
        },
      })),
    );

    return validVariations
      .map((v) => {
        // batchGetOrCreateInternalIds keys its result Map by the composite
        // `${externalId}:${connectionId}`, not the bare external id.
        const internalId = idMap.get(`${String(v.id)}:${this.connection.id}`);
        if (!internalId) {
          this.logger.warn(`No internal ID for WC variation ${String(v.id)}`);
          return null;
        }
        return { ...this.mapper.mapVariation(v, productId), id: internalId };
      })
      .filter((v): v is ProductVariant => v !== null);
  }

  async getProductCategories(productId: string): Promise<Category[]> {
    this.logger.debug(
      `Getting categories for product: ${productId} (connection: ${this.connection.id})`,
    );
    const externalIds = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Product,
      productId,
    );
    const mapping = externalIds.find((e) => e.connectionId === this.connection.id);
    if (!mapping) {
      throw new WooCommerceResourceNotFoundException(
        `Product not found: ${productId}`,
        CORE_ENTITY_TYPE.Product,
        productId,
        this.connection.id,
      );
    }
    // Request only the fields we need — avoids fetching the full product body.
    let product: Pick<WooCommerceProduct, 'categories'>;
    try {
      product = await this.httpClient.get<Pick<WooCommerceProduct, 'categories'>>(
        `/wp-json/wc/v3/products/${mapping.externalId}`,
        { _fields: 'id,categories' },
      );
    } catch (err) {
      if (err instanceof WooCommerceHttpResponseException && err.statusCode === 404) {
        throw new WooCommerceResourceNotFoundException(
          `WooCommerce product ${mapping.externalId} not found (deleted?)`,
          CORE_ENTITY_TYPE.Product,
          productId,
          this.connection.id,
        );
      }
      throw err;
    }
    return (product.categories ?? []).map((c) => ({ id: String(c.id), name: c.name }));
  }

  async getCategories(): Promise<Category[]> {
    this.logger.debug(`Getting all categories (connection: ${this.connection.id})`);
    const raw = await this.fetchAllPages<WooCommerceProductCategory>(
      '/wp-json/wc/v3/products/categories',
    );
    return raw
      .filter(
        (c): c is WooCommerceProductCategory & { id: number } =>
          c.id !== undefined && c.id !== null,
      )
      .map((c) => ({
        id: String(c.id),
        name: c.name ?? '',
        parentId: c.parent ? String(c.parent) : undefined,
      }));
  }

  async searchProducts(query: string, filters?: ProductFilters): Promise<Product[]> {
    this.logger.debug(`Searching products: "${query}" (connection: ${this.connection.id})`);
    return this.getProducts({ ...filters, query });
  }

  // ─── Write stubs (deferred to #879) ───────────────────────────────────────

  createProduct(_product: ProductCreate): Promise<Product> {
    return Promise.reject(
      new WooCommerceNotSupportedException('createProduct', 'Use the WooCommerce admin or #879'),
    );
  }

  updateProduct(_productId: string, _product: ProductUpdate): Promise<Product> {
    return Promise.reject(
      new WooCommerceNotSupportedException('updateProduct', 'Use the WooCommerce admin or #879'),
    );
  }

  deleteProduct(_productId: string): Promise<void> {
    return Promise.reject(
      new WooCommerceNotSupportedException('deleteProduct', 'Use the WooCommerce admin or #879'),
    );
  }

  upsertProductVariant(
    _productId: string,
    _variant: ProductVariantCreate,
  ): Promise<ProductVariant> {
    return Promise.reject(
      new WooCommerceNotSupportedException(
        'upsertProductVariant',
        'Use the WooCommerce admin or #879',
      ),
    );
  }

  assignCategories(_productId: string, _categoryIds: string[]): Promise<void> {
    return Promise.reject(
      new WooCommerceNotSupportedException(
        'assignCategories',
        'Use the WooCommerce admin or #879',
      ),
    );
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private buildWcParams(
    filters?: ProductFilters,
  ): Record<string, string | number | boolean> | undefined {
    const params: Record<string, string | number | boolean> = {};

    if (filters?.status === 'active') {
      params['status'] = 'publish';
    } else if (filters?.status === 'inactive') {
      params['status'] = 'draft';
    }
    // No status param when absent — WC default (publish) is correct

    if (filters?.query) {
      params['search'] = filters.query;
    }

    if (filters?.categoryIds?.[0]) {
      params['category'] = filters.categoryIds[0];
    }

    if (filters?.limit !== undefined) {
      params['per_page'] = filters.limit;
    }

    if (filters?.offset !== undefined && filters.limit !== undefined) {
      params['page'] = Math.floor(filters.offset / filters.limit) + 1;
    }

    return Object.keys(params).length > 0 ? params : undefined;
  }

  // Inline price parse for synthetic variant — mirrors parseOptionalNumber in the mapper.
  // Uses Number.isFinite so zero-price products (free downloads) are correctly preserved.
  private parseVariantPrice(value?: string): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : undefined;
  }
}
