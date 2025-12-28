/**
 * PrestaShop Product Master Adapter
 *
 * Implements ProductMasterPort for PrestaShop WebService API. Provides read-only
 * access to PrestaShop product catalog. Write operations throw NotSupportedException.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters
 * @implements {ProductMasterPort}
 */
import { ProductMasterPort, Product, ProductVariant, ProductFilters, ProductCreate, ProductUpdate, ProductVariantCreate, Category } from '@openlinker/core/products';
import { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';
import { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import { IPrestashopProductMapper, PrestashopProduct, PrestashopCombination } from '../mappers/prestashop.mapper.interface';
import {
  PrestashopNotSupportedException,
  PrestashopResourceNotFoundException,
} from '@openlinker/integrations-prestashop';
import { Logger } from '@openlinker/shared/logging';

/**
 * PrestaShop Product Master Adapter
 *
 * Read-only adapter for PrestaShop product catalog operations.
 */
export class PrestashopProductMasterAdapter implements ProductMasterPort {
  private readonly logger = new Logger(PrestashopProductMasterAdapter.name);

  constructor(
    private readonly httpClient: IPrestashopWebserviceClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly productMapper: IPrestashopProductMapper,
    private readonly connection: Connection,
  ) {}

  async getProduct(productId: string): Promise<Product> {
    this.logger.debug(`Getting product: ${productId} (connection: ${this.connection.id})`);

    // Resolve internal ID → external ID
    const externalIds = await this.identifierMapping.getExternalIds('Product', productId);
    const prestashopId = externalIds.find((e: { connectionId: string }) => e.connectionId === this.connection.id);

    if (!prestashopId) {
      throw new PrestashopResourceNotFoundException(
        `Product not found: ${productId} (no external ID mapping for connection ${this.connection.id})`,
        'Product',
        productId,
        this.connection.id,
      );
    }

    // Fetch from PrestaShop
    const prestashopProduct = await this.httpClient.getResource<PrestashopProduct>(
      'products',
      prestashopId.externalId,
    );

    // Map to OpenLinker schema
    const config = this.connection.config as { langId?: number };
    const langId = config.langId || 1;
    const mapped = this.productMapper.mapProduct(prestashopProduct, langId);

    // Return with internal ID
    return {
      ...mapped,
      id: productId,
    };
  }

  async getProducts(filters?: ProductFilters): Promise<Product[]> {
    this.logger.debug(`Getting products with filters (connection: ${this.connection.id})`);

    // Build PrestaShop filters
    const prestashopFilters = this.buildPrestashopFilters(filters);

    // Fetch from PrestaShop
    const prestashopProducts = await this.httpClient.listResources<PrestashopProduct>(
      'products',
      prestashopFilters,
      filters?.limit,
      filters?.offset,
    );

    if (prestashopProducts.length === 0) {
      return [];
    }

    // Batch identifier mapping
    const mappingRequests = prestashopProducts.map((p) => ({
      entityType: 'Product' as const,
      externalId: String(p.id),
      connectionId: this.connection.id,
    }));

    const idMap = await this.identifierMapping.batchGetOrCreateInternalIds(mappingRequests);

    // Map products with internal IDs
    const config = this.connection.config as { langId?: number };
    const langId = config.langId || 1;

    return prestashopProducts.map((prestashopProduct) => {
      const externalId = String(prestashopProduct.id);
      const internalId = idMap.get(`${externalId}:${this.connection.id}`) || idMap.get(externalId) || '';

      if (!internalId) {
        this.logger.warn(`No internal ID mapped for external product: ${externalId}`);
        return null;
      }

      const mapped = this.productMapper.mapProduct(prestashopProduct, langId);
      return {
        ...mapped,
        id: internalId,
      };
    }).filter((p): p is Product => p !== null);
  }

  async getProductVariants(productId: string): Promise<ProductVariant[]> {
    this.logger.debug(`Getting variants for product: ${productId} (connection: ${this.connection.id})`);

    // Resolve internal ID → external ID
    const externalIds = await this.identifierMapping.getExternalIds('Product', productId);
    const prestashopProductId = externalIds.find((e: { connectionId: string }) => e.connectionId === this.connection.id);

    if (!prestashopProductId) {
      throw new PrestashopResourceNotFoundException(
        `Product not found: ${productId} (no external ID mapping for connection ${this.connection.id})`,
        'Product',
        productId,
        this.connection.id,
      );
    }

    // Fetch combinations from PrestaShop
    const combinations = await this.httpClient.listResources<PrestashopCombination>(
      'combinations',
      {
        custom: {
          id_product: prestashopProductId.externalId,
        },
      },
    );

    if (combinations.length === 0) {
      return [];
    }

    // Batch identifier mapping for variants
    // Note: ProductVariant is not a separate EntityType in the core system
    // We'll use 'Product' entity type with context to indicate it's a variant
    // The variant ID will be stored in the mapping context metadata
    const mappingRequests = combinations.map((c) => ({
      entityType: 'Product' as const,
      externalId: String(c.id),
      connectionId: this.connection.id,
      context: {
        parentEntityType: 'Product',
        parentInternalId: productId,
        metadata: {
          isVariant: true,
          variantExternalId: String(c.id),
        },
      },
    }));

    const idMap = await this.identifierMapping.batchGetOrCreateInternalIds(mappingRequests);

    // Map variants with internal IDs
    return combinations.map((combination) => {
      const externalId = String(combination.id);
      const internalId = idMap.get(`${externalId}:${this.connection.id}`) || idMap.get(externalId) || '';

      if (!internalId) {
        this.logger.warn(`No internal ID mapped for external variant: ${externalId}`);
        return null;
      }

      const mapped = this.productMapper.mapVariant(combination, productId);
      return {
        ...mapped,
        id: internalId,
      };
    }).filter((v): v is ProductVariant => v !== null);
  }

  // Write operations - not supported in MVP
  createProduct(_product: ProductCreate): Promise<Product> {
    return Promise.reject(new PrestashopNotSupportedException(
      'Product creation is not supported in MVP. Use PrestaShop admin interface or future write-capability adapter.',
      'createProduct',
      'PrestaShop admin interface',
    ));
  }

  updateProduct(_productId: string, _product: ProductUpdate): Promise<Product> {
    return Promise.reject(new PrestashopNotSupportedException(
      'Product update is not supported in MVP. Use PrestaShop admin interface or future write-capability adapter.',
      'updateProduct',
      'PrestaShop admin interface',
    ));
  }

  deleteProduct(_productId: string): Promise<void> {
    return Promise.reject(new PrestashopNotSupportedException(
      'Product deletion is not supported in MVP. Use PrestaShop admin interface or future write-capability adapter.',
      'deleteProduct',
      'PrestaShop admin interface',
    ));
  }

  upsertProductVariant(_productId: string, _variant: ProductVariantCreate): Promise<ProductVariant> {
    return Promise.reject(new PrestashopNotSupportedException(
      'Variant creation/update is not supported in MVP. Use PrestaShop admin interface or future write-capability adapter.',
      'upsertProductVariant',
      'PrestaShop admin interface',
    ));
  }

  getProductCategories(_productId: string): Promise<Category[]> {
    return Promise.reject(new PrestashopNotSupportedException(
      'Get product categories is not implemented in MVP.',
      'getProductCategories',
      'Future implementation',
    ));
  }

  assignCategories(_productId: string, _categoryIds: string[]): Promise<void> {
    return Promise.reject(new PrestashopNotSupportedException(
      'Category assignment is not supported in MVP. Use PrestaShop admin interface or future write-capability adapter.',
      'assignCategories',
      'PrestaShop admin interface',
    ));
  }

  async searchProducts(_query: string, _filters?: ProductFilters): Promise<Product[]> {
    // For MVP, we can use getProducts with query filter
    return this.getProducts({
      ..._filters,
      query: _query,
    });
  }

  /**
   * Build PrestaShop filters from ProductFilters
   */
  private buildPrestashopFilters(filters?: ProductFilters): {
    ids?: (string | number)[];
    custom?: Record<string, string | number | (string | number)[]>;
  } {
    if (!filters) {
      return {};
    }

    const prestashopFilters: {
      ids?: (string | number)[];
      custom?: Record<string, string | number | (string | number)[]>;
    } = {};

    // Status filter
    if (filters.status) {
      prestashopFilters.custom = {
        ...prestashopFilters.custom,
        active: filters.status === 'active' ? 1 : 0,
      };
    }

    // Category filter (if supported)
    if (filters.categoryIds && filters.categoryIds.length > 0) {
      // Note: PrestaShop category filtering requires fetching products by category
      // For MVP, we'll skip this and filter in memory if needed
      this.logger.debug('Category filtering not fully implemented in MVP');
    }

    return prestashopFilters;
  }
}

