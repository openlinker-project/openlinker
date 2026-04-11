/**
 * PrestaShop Product Master Adapter
 *
 * Implements ProductMasterPort for PrestaShop WebService API. Provides read-only
 * access to PrestaShop product catalog. Write operations throw NotSupportedException.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters
 * @implements {ProductMasterPort}
 */
import { ProductMasterPort, Product, ProductVariant, ProductFilters, ProductCreate, ProductUpdate, ProductVariantCreate, Category, normalizeBarcode } from '@openlinker/core/products';
import { IdentifierMappingPort, Connection } from '@openlinker/core/identifier-mapping';
import { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import { IPrestashopProductMapper, PrestashopProduct, PrestashopCombination } from '../mappers/prestashop.mapper.interface';
import {
  PrestashopNotSupportedException,
  PrestashopResourceNotFoundException,
  PrestashopConnectionConfig,
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const error = new PrestashopResourceNotFoundException(
        `Product not found: ${productId} (no external ID mapping for connection ${this.connection.id})`,
        'Product',
        productId,
        this.connection.id,
      );
      throw error;
    }

    // Fetch from PrestaShop
    const prestashopProduct = await this.httpClient.getResource<PrestashopProduct>(
      'products',
      prestashopId.externalId,
    );

    // Map to OpenLinker schema
    const config = this.connection.config as unknown as PrestashopConnectionConfig;
    // Support both preferredLanguageId (new) and langId (deprecated, backward compatibility)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const configLangId: number | undefined = config.preferredLanguageId ?? config.langId;
    const langIdValue: number = configLangId ?? 1;
    
    const mapped = this.productMapper.mapProduct(prestashopProduct, langIdValue);

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
    const config = this.connection.config as unknown as PrestashopConnectionConfig;
    // Support both preferredLanguageId (new) and langId (deprecated, backward compatibility)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const configLangId: number | undefined = config.preferredLanguageId ?? config.langId;
    const langIdValue: number = configLangId ?? 1;

    return prestashopProducts.map((prestashopProduct) => {
      const externalId = String(prestashopProduct.id);
      const internalId = idMap.get(`${externalId}:${this.connection.id}`) || idMap.get(externalId) || '';

      if (!internalId) {
        this.logger.warn(`No internal ID mapped for external product: ${externalId}`);
        return null;
      }

      const mapped = this.productMapper.mapProduct(prestashopProduct, langIdValue);
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const error = new PrestashopResourceNotFoundException(
        `Product not found: ${productId} (no external ID mapping for connection ${this.connection.id})`,
        'Product',
        productId,
        this.connection.id,
      );
      throw error;
    }

    // Fetch product for barcode fallback / synthetic variant
    const prestashopProduct = await this.httpClient.getResource<PrestashopProduct>(
      'products',
      prestashopProductId.externalId,
    );

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
      const syntheticExternalId = `product:${prestashopProductId.externalId}`;
      const internalId = await this.identifierMapping.getOrCreateInternalId(
        'Product',
        syntheticExternalId,
        this.connection.id,
        {
          parentEntityType: 'Product',
          parentInternalId: productId,
          metadata: {
            isVariant: true,
            variantExternalId: syntheticExternalId,
            synthetic: true,
          },
        },
      );
      const sku = prestashopProduct.reference ?? `product-${prestashopProductId.externalId}`;
      const productEan = this.normalizeEan(prestashopProduct.ean13);
      const productGtin = this.normalizeGtin(prestashopProduct.upc);

      return [
        {
          id: internalId,
          productId,
          sku,
          ean: productEan ?? undefined,
          gtin: productGtin ?? undefined,
        },
      ];
    }

    // Ensure stale synthetic variant mapping is removed once combinations exist
    const syntheticExternalId = `product:${prestashopProductId.externalId}`;
    await this.identifierMapping.deleteMapping('Product', syntheticExternalId, this.connection.id);

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

    const productEan = this.normalizeEan(prestashopProduct.ean13);
    const productGtin = this.normalizeGtin(prestashopProduct.upc);

    // Map variants with internal IDs
    return combinations.map((combination) => {
      const externalId = String(combination.id);
      const internalId = idMap.get(`${externalId}:${this.connection.id}`) || idMap.get(externalId) || '';

      if (!internalId) {
        this.logger.warn(`No internal ID mapped for external variant: ${externalId}`);
        return null;
      }

      const mapped = this.productMapper.mapVariant(combination, productId);
      if (combinations.length === 1) {
        if (!mapped.ean && productEan) {
          mapped.ean = productEan;
        }
        if (!mapped.gtin && productGtin) {
          mapped.gtin = productGtin;
        }
      }
      return {
        ...mapped,
        id: internalId,
      };
    }).filter((v): v is ProductVariant => v !== null);
  }

  private normalizeEan(value?: string | null): string | null {
    const normalized = normalizeBarcode(value ?? null);
    return normalized && normalized.length === 13 ? normalized : null;
  }

  private normalizeGtin(value?: string | null): string | null {
    return normalizeBarcode(value ?? null);
  }

  // Write operations - not supported in MVP
  createProduct(_product: ProductCreate): Promise<Product> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const error = new PrestashopNotSupportedException(
      'Product creation is not supported in MVP. Use PrestaShop admin interface or future write-capability adapter.',
      'createProduct',
      'PrestaShop admin interface',
    );
    return Promise.reject(error);
  }

  updateProduct(_productId: string, _product: ProductUpdate): Promise<Product> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const error = new PrestashopNotSupportedException(
      'Product update is not supported in MVP. Use PrestaShop admin interface or future write-capability adapter.',
      'updateProduct',
      'PrestaShop admin interface',
    );
    return Promise.reject(error);
  }

  deleteProduct(_productId: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const error = new PrestashopNotSupportedException(
      'Product deletion is not supported in MVP. Use PrestaShop admin interface or future write-capability adapter.',
      'deleteProduct',
      'PrestaShop admin interface',
    );
    return Promise.reject(error);
  }

  upsertProductVariant(_productId: string, _variant: ProductVariantCreate): Promise<ProductVariant> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const error = new PrestashopNotSupportedException(
      'Variant creation/update is not supported in MVP. Use PrestaShop admin interface or future write-capability adapter.',
      'upsertProductVariant',
      'PrestaShop admin interface',
    );
    return Promise.reject(error);
  }

  getProductCategories(_productId: string): Promise<Category[]> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const error = new PrestashopNotSupportedException(
      'Get product categories is not implemented in MVP.',
      'getProductCategories',
      'Future implementation',
    );
    return Promise.reject(error);
  }

  assignCategories(_productId: string, _categoryIds: string[]): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const error = new PrestashopNotSupportedException(
      'Category assignment is not supported in MVP. Use PrestaShop admin interface or future write-capability adapter.',
      'assignCategories',
      'PrestaShop admin interface',
    );
    return Promise.reject(error);
  }

  async getCategories(): Promise<Category[]> {
    this.logger.debug(`Fetching all categories (connection: ${this.connection.id})`);

    const raw = await this.httpClient.listResources<Record<string, unknown>>('categories');

    const langId = this.getLangId();

    return raw.map((cat) => {
      const id = String(cat['id'] ?? '');
      const nameField = cat['name'];
      let name = `Category ${id}`;
      if (typeof nameField === 'string') {
        name = nameField;
      } else if (Array.isArray(nameField)) {
        const lang = (nameField as Array<{ language?: Array<{ attrs?: { id: string }; value: string }> }>)
          .flatMap((n) => n.language ?? [])
          .find((l) => String(l.attrs?.id) === String(langId));
        if (lang) {
          name = lang.value;
        }
      }

      const parentId = String(cat['id_parent'] ?? '0');
      const depth = Number(cat['level_depth'] ?? 0);

      return {
        id,
        name,
        parentId: parentId === '0' ? undefined : parentId,
        depth,
        active: String(cat['active']) === '1',
      };
    }).filter((c) => Number(c.depth) > 0); // Exclude root node
  }

  private getLangId(): number {
    const config = this.connection.config as Record<string, unknown> | undefined;
    return Number(config?.['languageId'] ?? 1);
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

