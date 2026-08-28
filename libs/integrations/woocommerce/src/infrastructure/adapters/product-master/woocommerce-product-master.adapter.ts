/**
 * WooCommerce Product Master Adapter
 *
 * Implements ProductMasterPort for WooCommerce REST API v3.
 * Read methods (#874): getProduct, getProducts, getProductVariants,
 *   getProductCategories, getCategories, searchProducts, listExternalIds.
 * Modified-since rung (#2220): listExternalIdsModifiedSince — see the caveat below.
 * Write methods (#879): createProduct, updateProduct, deleteProduct,
 *   upsertProductVariant, assignCategories.
 *
 * Pagination: single-page fetch consistent with PrestashopProductMasterAdapter.
 * The caller (master-product-sync-all.handler.ts) drives the loop via
 * listExternalIds({ limit, offset }). Offset is translated to WC page numbers
 * using page = Math.floor(offset / perPage) + 1.
 *
 * Modified-since rung caveat (#2220, ADR-048): this adapter declares
 * `ModifiedProductLister`, but the freshness it reports is PRODUCT-LEVEL ONLY.
 * A variation edit does NOT bump the parent's `date_modified`
 * (https://github.com/woocommerce/woocommerce/issues/19562, open since 3.4) and
 * there is no store-wide variations collection to enumerate instead. Stock is not
 * on this rung either: `update_product_stock()` writes raw SQL that bypasses
 * `wp_update_post()`, so order-driven stock reduction never surfaces in
 * `modified_after`. Do not "verify" this rung with a REST round-trip — a REST PUT
 * *does* bump `date_modified`, so such a test reports the opposite of the truth.
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
import { MasterProductNotFoundError } from '@openlinker/core/products';
import type {
  ModifiedProductLister,
  ListExternalIdsModifiedSinceInput,
  ProductTaxRateReader,
  ReadProductTaxRateInput,
  TaxRateResolution,
} from '@openlinker/core/products';
import type { IdentifierMappingPort, Connection } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import { clampToAdapterPageSize } from '@openlinker/core/operational-settings';
import type { IWooCommerceHttpClient } from '../../http/woocommerce-http-client.interface';
import { WooCommerceHttpResponseException } from '../../http/woocommerce-http-response.exception';
import type { IWooCommerceProductMapper } from '../../mappers/woocommerce-product.mapper.interface';
import {
  buildSyntheticVariantExternalId,
  isSyntheticVariantExternalId,
} from '../../mappers/woocommerce-variant-id';
import { WooCommerceResourceNotFoundException } from '../../../domain/exceptions/woocommerce-resource-not-found.exception';
import { WooCommerceDuplicateSkuException } from '../../../domain/exceptions/woocommerce-duplicate-sku.exception';
import type {
  WooCommerceProduct,
  WooCommerceProductVariation,
  WooCommerceProductCategory,
  WooCommerceProductWriteRequest,
  WooCommerceVariationWriteRequest,
  WooCommerceTaxRate,
  WooCommerceGeneralSetting,
} from './woocommerce-product.types';
import { fetchAllPages } from '../../utils/woocommerce-utils';

/**
 * WooCommerce's REST layer caps `per_page` at 100 on every list endpoint
 * (#1723). This is a genuine PLATFORM wall, unlike the advisory ceilings in
 * `OPERATIONAL_SETTING_BOUNDS`: above it the shop does not return a bigger
 * page, it returns 100 or a 400. It is enforced here, at the point the request
 * is built, because this is the only place that knows WooCommerce is the
 * adapter about to send it - and it is LOGGED when it bites, so a page size an
 * operator set can never be reported back to them intact while quietly not
 * being what was sent.
 */
const WC_MAX_PER_PAGE = 100;

export class WooCommerceProductMasterAdapter
  implements ProductMasterPort, ModifiedProductLister, ProductTaxRateReader
{
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
    const perPage = this.resolvePerPage(filters?.limit ?? 100, 'listExternalIds');
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

  /**
   * Modified-since rung (#2220, ADR-048 decision 1).
   *
   * `dates_are_gmt: true` is the load-bearing literal. WooCommerce's default is
   * `false`, which compares `modified_after` against the SITE's local time — so
   * without the flag, products modified inside the local-offset window are silently
   * skipped once the watermark has advanced past them. The order source carries the
   * same flag for the same reason (`woocommerce-order-source.adapter.ts`); this is
   * an established fix, not a new theory. Requires WC >= 5.8.
   *
   * `orderby=modified&order=asc` keeps newly modified rows landing PAST the read
   * cursor rather than shuffling into pages already read. It does not make offset
   * paging fully stable — a row re-modified mid-cycle moves to the tail and shifts
   * later rows left, so one row can be stepped over for that cycle (ADR-048
   * amendment #2220). That window is covered by the full `master.product.syncAll`
   * pass, which is why the delta pass is additive rather than a replacement.
   *
   * Note `per_page` is the caller's page size, never a sweep budget: WooCommerce
   * hard-caps it at 100 and rejects more with HTTP 400 (#1723).
   */
  async listExternalIdsModifiedSince(
    input: ListExternalIdsModifiedSinceInput,
  ): Promise<string[]> {
    const { since, limit, offset } = input;
    this.logger.debug(
      `Listing external product IDs modified since ${since.toISOString()} ` +
        `(connection: ${this.connection.id}, limit: ${String(limit)}, offset: ${String(offset)})`,
    );
    const perPage = this.resolvePerPage(limit, 'listExternalIdsModifiedSince');
    // Same derivation as listExternalIds — exact while the caller keeps `offset` a
    // multiple of `limit`, which the bounded sweep's page loop does. Derived from
    // the REQUESTED limit, not the clamped one, so a clamp narrows the page
    // without also skewing which page is asked for.
    const page = Math.floor(offset / limit) + 1;
    const raw = await this.httpClient.get<Array<{ id: number }>>('/wp-json/wc/v3/products', {
      _fields: 'id',
      per_page: perPage,
      page,
      modified_after: since.toISOString(),
      dates_are_gmt: true,
      orderby: 'modified',
      order: 'asc',
    });
    return raw
      .filter((r): r is { id: number } => r.id !== undefined && r.id !== null)
      .map((r) => String(r.id));
  }

  async getProduct(productId: string): Promise<Product> {
    this.logger.debug(`Getting product: ${productId} (connection: ${this.connection.id})`);
    try {
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
    } catch (error) {
      // Translate the platform not-found (missing mapping OR a 404, i.e. deleted
      // at the master) into the neutral core error so core services can
      // distinguish deletion from a transient failure (#1599).
      if (error instanceof WooCommerceResourceNotFoundException) {
        throw new MasterProductNotFoundError(productId, this.connection.id, error);
      }
      throw error;
    }
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
      const syntheticExternalId = buildSyntheticVariantExternalId(wcId);
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
      buildSyntheticVariantExternalId(wcId),
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
    let raw: WooCommerceProduct;
    try {
      raw = await this.httpClient.post<WooCommerceProduct>('/wp-json/wc/v3/products', payload);
    } catch (err) {
      if (this.isDuplicateSkuError(err)) {
        throw new WooCommerceDuplicateSkuException(product.sku, this.connection.id);
      }
      throw err;
    }
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
      // force=true is a permanent delete (bypasses the WC trash). Without it WC
      // soft-deletes (trashes) the product, leaving its SKU occupied — which
      // breaks the port contract ("delete from the external system") and blocks
      // re-creating a product with the same SKU.
      await this.httpClient.delete(`/wp-json/wc/v3/products/${mapping.externalId}`, {
        force: true,
      });
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

    // Exhaust all pages so the existing-SKU lookup is correct regardless of
    // variation count. A single per_page=100 fetch silently misses a target
    // SKU on page 2+, causing a duplicate variation to be POSTed instead of an
    // update for variable products with >100 variations.
    let variations: WooCommerceProductVariation[];
    try {
      variations = await fetchAllPages<WooCommerceProductVariation>(
        `/wp-json/wc/v3/products/${wcId}/variations`,
        this.httpClient,
        this.logger,
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

  // WC rejects a duplicate SKU with HTTP 400 + error code `product_invalid_sku`.
  private isDuplicateSkuError(err: unknown): boolean {
    return (
      err instanceof WooCommerceHttpResponseException &&
      err.statusCode === 400 &&
      err.errorCode === 'product_invalid_sku'
    );
  }

  // Inline price parse for synthetic variant — mirrors parseOptionalNumber in the mapper.
  // Uses Number.isFinite so zero-price products (free downloads) are correctly preserved.
  private parseVariantPrice(value?: string): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : undefined;
  }

  // ─── Tax rate (#2054, ADR-063) ─────────────────────────────────────────────

  /**
   * WooCommerce keys tax per variation as well as per product: a variation
   * carries its own `tax_class`, defaulting to `'parent'`. So the caller reads
   * both levels, and an inheriting variation answers `inherited` rather than
   * echoing the product's code.
   */
  readsTaxRatePerVariant(): boolean {
    return true;
  }

  /**
   * Resolve the store's tax rate for a product or variation.
   *
   * WooCommerce does not store a rate on the product. It stores a **class
   * name**, and the rate table lives in store settings, keyed by country. So
   * the read is three hops: the product's `tax_class` and `tax_status`, the
   * store's own country, and the rows of that class.
   *
   * Four answers, and the boundaries between them are the point.
   *
   * - `tax_status: 'none'` is a **resolved zero**. It is the operator saying
   *   this product is not taxed, exactly like PrestaShop's "No tax" - not a
   *   gap. (`'shipping'` means only the shipping portion is taxed, which is a
   *   statement about shipping and not about this line, so it is treated as
   *   taxable here.)
   * - Exactly one matching row is the rate.
   * - No row for the store's country is `not-configured`: the class exists but
   *   the operator has not given it a rate here, which they fix in WooCommerce.
   * - Several rows with different rates is `ambiguous`. WooCommerce would pick
   *   by priority, postcode and city at checkout; reproducing that here would
   *   be OpenLinker computing tax, which ADR-063 forbids. Note that several
   *   rows agreeing on one rate is **not** ambiguous - the answer is the same
   *   whichever the shop picks.
   *
   * - A store declaring no selling country is `not-configured` too: nothing can
   *   be matched against the rate table, and the fix is a WooCommerce setting.
   *
   * Transport failures propagate - including the store-country read, whose
   * failure used to be swallowed into `unreadable` and then persisted as
   * *no rate*, so one 500 on `/settings/general` during a sweep flipped a whole
   * catalogue from *not checked* to *rate-less* (#2054 review). The sync
   * swallows the throw per product and leaves the row untouched.
   */
  async readProductTaxRate(input: ReadProductTaxRateInput): Promise<TaxRateResolution> {
    const wcProductId = await this.resolveWcProductId(input.productId);

    const taxed = input.variantId
      ? await this.readVariationTaxFields(wcProductId, input.variantId)
      : await this.readProductTaxFields(wcProductId);

    if (taxed === 'inherited') return { kind: 'inherited' };

    if (taxed.taxStatus === 'none') {
      return {
        kind: 'resolved',
        code: '0',
        countryIso2: await this.readStoreCountryForProvenance(),
      };
    }

    // Throws on a failed settings call, so the sync leaves the catalogue row
    // untouched instead of recording a false "no rate" (#2054 review).
    const storeCountry = await this.readStoreCountry();
    if (!storeCountry) {
      // The store answered and declares no selling country, so no rate row can
      // be matched: an answer, and one the operator fixes in WooCommerce - hence
      // `not-configured` rather than `unreadable`, which never persists.
      return {
        kind: 'unknown',
        reason: 'not-configured',
        detail: 'the store does not declare a selling country',
      };
    }

    // `''` is WooCommerce's own slug for the standard class; the taxes endpoint
    // spells it `standard`.
    const classSlug = taxed.taxClass === '' || taxed.taxClass === undefined ? 'standard' : taxed.taxClass;
    const rows = await this.httpClient.get<WooCommerceTaxRate[]>('/wp-json/wc/v3/taxes', {
      class: classSlug,
      per_page: 100,
    });

    // An empty `country` is WooCommerce's wildcard row - it applies everywhere,
    // so it is a match rather than a row to skip.
    const applicable = (rows ?? []).filter(
      (row) => !row.country || row.country.toUpperCase() === storeCountry
    );

    const distinctRates = [
      ...new Set(
        applicable
          .map((row) => normalizeWcRate(row.rate))
          .filter((code): code is string => code !== null)
      ),
    ];

    if (distinctRates.length === 0) {
      return {
        kind: 'unknown',
        reason: 'not-configured',
        detail: `tax class "${classSlug}" has no rate for ${storeCountry}`,
      };
    }
    if (distinctRates.length > 1) {
      return {
        kind: 'unknown',
        reason: 'ambiguous',
        detail: `tax class "${classSlug}" has ${String(distinctRates.length)} different rates for ${storeCountry}`,
      };
    }

    return { kind: 'resolved', code: distinctRates[0], countryIso2: storeCountry };
  }

  private async resolveWcProductId(internalProductId: string): Promise<string> {
    const externalIds = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Product,
      internalProductId
    );
    const mapping = externalIds.find((e) => e.connectionId === this.connection.id);
    if (!mapping) {
      throw new MasterProductNotFoundError(internalProductId, this.connection.id);
    }
    return mapping.externalId;
  }

  private async readProductTaxFields(
    wcProductId: string
  ): Promise<{ taxClass?: string; taxStatus?: string }> {
    const product = await this.httpClient.get<WooCommerceProduct>(
      `/wp-json/wc/v3/products/${wcProductId}`,
      { _fields: 'id,tax_class,tax_status' }
    );
    return { taxClass: product.tax_class, taxStatus: product.tax_status };
  }

  /**
   * A synthetic variant IS the simple product, so it reads the product's own
   * fields rather than a variation that does not exist.
   */
  private async readVariationTaxFields(
    wcProductId: string,
    internalVariantId: string
  ): Promise<{ taxClass?: string; taxStatus?: string } | 'inherited'> {
    const externalIds = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.ProductVariant,
      internalVariantId
    );
    const mapping = externalIds.find((e) => e.connectionId === this.connection.id);
    if (!mapping) return 'inherited';
    if (isSyntheticVariantExternalId(mapping.externalId)) {
      return this.readProductTaxFields(wcProductId);
    }

    const variation = await this.httpClient.get<WooCommerceProductVariation>(
      `/wp-json/wc/v3/products/${wcProductId}/variations/${mapping.externalId}`,
      { _fields: 'id,tax_class,tax_status' }
    );
    if (variation.tax_class === 'parent' || variation.tax_class === undefined) return 'inherited';
    return { taxClass: variation.tax_class, taxStatus: variation.tax_status };
  }

  /**
   * The store's own selling country, from `woocommerce_default_country`.
   *
   * The setting is `PL` or `PL:MZ` (country plus state), so only the part
   * before the colon is the country. `null` means the store answered and
   * declares none.
   *
   * **A transport failure throws**, per the capability contract: `unknown` is
   * reserved for "the master answered", and the caller persists an `unknown` as
   * the *no-rate* state. Swallowing a 500 on `/settings/general` here therefore
   * used to record a whole catalogue as rate-less off one failed call - blocking
   * documents and refusing publishes for products whose shop configuration was
   * perfectly fine. The master sync already swallows a throw per product and
   * leaves the row untouched, which is the honest outcome.
   *
   * **Only a successful read is cached.** Caching the failure would keep the
   * false answer alive for the adapter's lifetime, and the resolved-zero path
   * below deliberately tolerates a failure to fetch provenance - so a cached
   * `null` from that tolerance must not become the rate path's answer.
   */
  private async readStoreCountry(): Promise<string | null> {
    if (this.storeCountry !== undefined) return this.storeCountry;
    const settings = await this.httpClient.get<WooCommerceGeneralSetting[]>(
      '/wp-json/wc/v3/settings/general'
    );
    const raw = settings?.find((s) => s.id === 'woocommerce_default_country')?.value;
    const value = Array.isArray(raw) ? raw[0] : raw;
    this.storeCountry = value ? (value.split(':')[0]?.toUpperCase() ?? null) : null;
    return this.storeCountry;
  }

  /**
   * The same read, for the country carried as **provenance only**.
   *
   * A `tax_status: 'none'` product is a resolved zero whatever the store's
   * country turns out to be, so losing the country must not lose the rate:
   * here, and only here, a failure degrades to `null` (`ResolvedTaxRate.countryIso2`
   * is documented as provenance that blocks nothing).
   */
  private async readStoreCountryForProvenance(): Promise<string | null> {
    try {
      return await this.readStoreCountry();
    } catch (error) {
      this.logger.warn(
        `Could not read the store's selling country for provenance (connection: ${this.connection.id}): ${(error as Error).message}`
      );
      return null;
    }
  }

  private storeCountry: string | null | undefined;

  /**
   * Narrow a requested page size to what WooCommerce will actually honour.
   *
   * Warns when it bites. A silent clamp is the reported-versus-enforced defect
   * in miniature: the operator set 250, the settings page reports 250, and the
   * shop was asked for 100 - with nothing anywhere saying so.
   */
  private resolvePerPage(requested: number, operation: string): number {
    const { value, clamped } = clampToAdapterPageSize(requested, WC_MAX_PER_PAGE);
    if (clamped) {
      this.logger.warn(
        `WooCommerce caps per_page at ${String(WC_MAX_PER_PAGE)}; ${operation} requested ` +
          `${String(requested)} and was clamped (connection: ${this.connection.id}). ` +
          `Lower the sweep page size to ${String(WC_MAX_PER_PAGE)} or below to make the ` +
          `configured value match what is sent.`,
      );
    }
    return value;
  }
}

/**
 * WooCommerce reports a rate as a percent string with trailing zeros
 * (`'23.0000'`). The neutral contract is percent-as-string without them
 * (#2247), because the FA(3) map and the Erli enum are both keyed on the bare
 * form. Returns `null` for anything unparseable, which the caller counts as
 * "not a rate" rather than as a zero.
 */
function normalizeWcRate(raw: string | undefined): string | null {
  if (raw === undefined || raw === null || raw.trim() === '') return null;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed * 100) / 100;
  return String(rounded);
}
