/**
 * WooCommerce Product Master Adapter
 *
 * Implements ProductMasterPort for WooCommerce REST API v3.
 * Read methods (#874): getProduct, getProducts, getProductVariants,
 *   getProductCategories, getCategories, searchProducts, listExternalIds.
 * Write methods (#879): createProduct, updateProduct, deleteProduct,
 *   upsertProductVariant, assignCategories.
 *
 * Pagination: single-page fetch consistent with PrestashopProductMasterAdapter.
 * The caller (master-product-sync-all.handler.ts) drives the loop via
 * listExternalIds({ limit, offset }). Offset is translated to WC page numbers
 * using page = Math.floor(offset / perPage) + 1.
 *
 * 404 handling: WooCommerceHttpClient throws WooCommerceHttpResponseException(404)
 * for not-found responses. All read and write methods catch and rethrow as
 * WooCommerceResourceNotFoundException with full entity context — consistent
 * boundary contract across the adapter.
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
import { WooCommerceResourceNotFoundException } from '../../../domain/exceptions/woocommerce-resource-not-found.exception';
import type {
  WooCommerceProduct,
  WooCommerceProductVariation,
  WooCommerceProductCategory,
  WooCommerceProductWriteRequest,
  WooCommerceVariationWriteRequest,
} from './woocommerce-product.types';
import { fetchAllPages } from '../../utils/woocommerce-utils';

export class WooCommerceProductMasterAdapter implements ProductMasterPort {
  private readonly logger = new Logger(WooCommerceProductMasterAdapter.name);

  constructor(
    private readonly httpClient: IWooCommerceHttpClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly mapper: IWooCommerceProductMapper,
    private readonly connection: Connection,
  ) {}

  // ─── Read methods ──────────────────────────────────────────────────────────

  async listExternalIds(filters?: { limit?: number; offset?: number }): Promise<string[]> {
    this.logger.debug(
      `Listing external product IDs (connection: ${this.connection.id}, limit: ${String(filters?.limit)}, offset: ${String(filters?.offset)})`,
    );
    const perPage = filters?.limit ?? 100;
    const page =
      filters?.offset !== undefined ? Math.floor(filters.offset / perPage) + 1 : 1;
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
      return [
        {
          id: internalVariantId,
          productId,
          sku: product.sku || `product-${wcId}`,
          attributes: null,
          ean: null,
          gtin: null,
          price,
        },
      ];
    }

    // Variable product — delete stale synthetic (safe no-op if absent)
    await this.identifierMapping.deleteMapping(
      CORE_ENTITY_TYPE.ProductVariant,
      `product:${wcId}`,
      this.connection.id,
    );

    // Exhaust all pages — products with >100 variations exist (configurable products, apparel).
    const variations = await fetchAllPages<WooCommerceProductVariation>(
      `/wp-json/wc/v3/products/${wcId}/variations`,
      this.httpClient,
      this.logger,
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
    const raw = await fetchAllPages<WooCommerceProductCategory>(
      '/wp-json/wc/v3/products/categories',
      this.httpClient,
      this.logger,
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

  // ─── Write methods ─────────────────────────────────────────────────────────

  async createProduct(product: ProductCreate): Promise<Product> {
    this.logger.debug(`Creating product: ${product.sku} (connection: ${this.connection.id})`);
    const payload: WooCommerceProductWriteRequest = {
      name: product.name,
      sku: product.sku,
      ...(product.description !== undefined ? { description: product.description } : {}),
      regular_price: String(product.price),
      ...(product.weight !== undefined ? { weight: String(product.weight) } : {}),
    };
    const raw = await this.httpClient.post<WooCommerceProduct>('/wp-json/wc/v3/products', payload);
    const internalId = await this.identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.Product,
      String(raw.id),
      this.connection.id,
    );
    return { ...this.mapper.mapProduct(raw), id: internalId };
  }

  async updateProduct(productId: string, product: ProductUpdate): Promise<Product> {
    this.logger.debug(`Updating product: ${productId} (connection: ${this.connection.id})`);
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
    const wcId = mapping.externalId;
    const payload: WooCommerceProductWriteRequest = {};
    if (product.name !== undefined) payload.name = product.name;
    if (product.sku !== undefined) payload.sku = product.sku;
    if (product.description !== undefined) payload.description = product.description;
    if (product.price !== undefined) payload.regular_price = String(product.price);
    if (product.weight !== undefined) payload.weight = String(product.weight);

    let raw: WooCommerceProduct;
    try {
      raw = await this.httpClient.put<WooCommerceProduct>(
        `/wp-json/wc/v3/products/${wcId}`,
        payload,
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
    return { ...this.mapper.mapProduct(raw), id: productId };
  }

  async deleteProduct(productId: string): Promise<void> {
    this.logger.debug(`Deleting product: ${productId} (connection: ${this.connection.id})`);
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
    try {
      await this.httpClient.delete(`/wp-json/wc/v3/products/${mapping.externalId}`);
    } catch (err) {
      if (err instanceof WooCommerceHttpResponseException && err.statusCode === 404) {
        // Product is already trashed/deleted — caller's intent is satisfied.
        return;
      }
      throw err;
    }
  }

  async upsertProductVariant(productId: string, variant: ProductVariantCreate): Promise<ProductVariant> {
    this.logger.debug(
      `Upserting variant sku=${variant.sku} for product: ${productId} (connection: ${this.connection.id})`,
    );
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
    const wcId = mapping.externalId;

    let variations: WooCommerceProductVariation[];
    try {
      variations = await this.httpClient.get<WooCommerceProductVariation[]>(
        `/wp-json/wc/v3/products/${wcId}/variations`,
        { per_page: 100 },
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

    if (variations.length >= 100) {
      this.logger.warn(
        `upsertProductVariant: variations list saturated at 100 for product ${wcId} ` +
          `(connection: ${this.connection.id}) — SKU lookup may be incomplete`,
      );
    }

    const varPayload: WooCommerceVariationWriteRequest = {
      sku: variant.sku,
      ...(variant.price !== undefined ? { regular_price: String(variant.price) } : {}),
      ...(variant.weight !== undefined ? { weight: String(variant.weight) } : {}),
      ...(variant.attributes
        ? {
            attributes: Object.entries(variant.attributes).map(([name, option]) => ({
              name,
              option,
            })),
          }
        : {}),
    };

    const variantContext = {
      parentEntityType: CORE_ENTITY_TYPE.Product,
      parentInternalId: productId,
    };

    const existing = variations.find((v) => v.sku === variant.sku);

    if (existing) {
      const varId = existing.id;
      let raw: WooCommerceProductVariation;
      try {
        raw = await this.httpClient.put<WooCommerceProductVariation>(
          `/wp-json/wc/v3/products/${wcId}/variations/${String(varId)}`,
          varPayload,
        );
      } catch (err) {
        if (err instanceof WooCommerceHttpResponseException && err.statusCode === 404) {
          throw new WooCommerceResourceNotFoundException(
            `WooCommerce variation ${String(varId)} not found (deleted?)`,
            CORE_ENTITY_TYPE.ProductVariant,
            String(varId),
            this.connection.id,
          );
        }
        throw err;
      }
      // Use existing.id (known from the SKU-match) rather than raw.id (PUT response field
      // is optional in the type) to guarantee we never register "undefined" as an external ID.
      const internalId = await this.identifierMapping.getOrCreateInternalId(
        CORE_ENTITY_TYPE.ProductVariant,
        String(existing.id),
        this.connection.id,
        { ...variantContext, metadata: { variantExternalId: String(existing.id) } },
      );
      return { ...this.mapper.mapVariation(raw, productId), id: internalId };
    }

    // SKU not found — create new variation
    const raw = await this.httpClient.post<WooCommerceProductVariation>(
      `/wp-json/wc/v3/products/${wcId}/variations`,
      varPayload,
    );
    const internalId = await this.identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.ProductVariant,
      String(raw.id),
      this.connection.id,
      { ...variantContext, metadata: { variantExternalId: String(raw.id) } },
    );
    return { ...this.mapper.mapVariation(raw, productId), id: internalId };
  }

  async assignCategories(productId: string, categoryIds: string[]): Promise<void> {
    this.logger.debug(
      `Assigning ${categoryIds.length} categories to product: ${productId} (connection: ${this.connection.id})`,
    );
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
    try {
      await this.httpClient.put(`/wp-json/wc/v3/products/${mapping.externalId}`, {
        categories: categoryIds.map((id) => ({ id: Number(id) })),
      });
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
