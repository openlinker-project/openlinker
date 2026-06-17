/**
 * PrestaShop Product Master Adapter
 *
 * Implements ProductMasterPort for PrestaShop WebService API. Provides read-only
 * access to PrestaShop product catalog. Write operations throw NotSupportedException.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters
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
import { normalizeBarcode, normalizeToEan13 } from '@openlinker/core/products';
import type { IdentifierMappingPort, Connection } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import type {
  IPrestashopProductMapper,
  PrestashopProduct,
  PrestashopCombination,
} from '../mappers/prestashop.mapper.interface';
import type { PrestashopConnectionConfig } from '@openlinker/integrations-prestashop';
import {
  PrestashopNotSupportedException,
  PrestashopResourceNotFoundException,
} from '@openlinker/integrations-prestashop';
import { Logger } from '@openlinker/shared/logging';
import type { PrestashopAttributeResolver } from '../provisioners/prestashop-attribute.resolver';
import type { OptionValueResolver } from '../../domain/types/prestashop-product-option.types';

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
    // Optional so existing constructions (tests) stay valid; the factory always
    // supplies a process-singleton instance so its option-value cache persists
    // across per-product adapter instances (#1050).
    private readonly attributeResolver?: PrestashopAttributeResolver
  ) {}

  async getProduct(productId: string): Promise<Product> {
    this.logger.debug(`Getting product: ${productId} (connection: ${this.connection.id})`);

    // Resolve internal ID → external ID
    const externalIds = await this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Product, productId);
    const prestashopId = externalIds.find(
      (e: { connectionId: string }) => e.connectionId === this.connection.id
    );

    if (!prestashopId) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
      const error = new PrestashopResourceNotFoundException(
        `Product not found: ${productId} (no external ID mapping for connection ${this.connection.id})`,
        CORE_ENTITY_TYPE.Product,
        productId,
        this.connection.id
      );
      throw error;
    }

    // Fetch from PrestaShop
    const prestashopProduct = await this.httpClient.getResource<PrestashopProduct>(
      'products',
      prestashopId.externalId
    );

    // Map to OpenLinker schema
    const langIdValue: number = this.resolveLangId();

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
      filters?.offset
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
    const langIdValue: number = this.resolveLangId();

    return prestashopProducts
      .map((prestashopProduct) => {
        const externalId = String(prestashopProduct.id);
        const internalId =
          idMap.get(`${externalId}:${this.connection.id}`) || idMap.get(externalId) || '';

        if (!internalId) {
          this.logger.warn(`No internal ID mapped for external product: ${externalId}`);
          return null;
        }

        const mapped = this.productMapper.mapProduct(prestashopProduct, langIdValue);
        return {
          ...mapped,
          id: internalId,
        };
      })
      .filter((p): p is Product => p !== null);
  }

  async listExternalIds(filters?: { limit?: number; offset?: number }): Promise<string[]> {
    this.logger.debug(
      `Listing external product IDs (connection: ${this.connection.id}, limit: ${String(filters?.limit)}, offset: ${String(filters?.offset)})`
    );

    const raw = await this.httpClient.listResources<{ id: string | number }>(
      'products',
      { display: '[id]' },
      filters?.limit,
      filters?.offset
    );

    return raw
      .map((r) => (r.id !== undefined && r.id !== null ? String(r.id) : ''))
      .filter((id) => id.length > 0);
  }

  async getProductVariants(productId: string): Promise<ProductVariant[]> {
    this.logger.debug(
      `Getting variants for product: ${productId} (connection: ${this.connection.id})`
    );

    // Resolve internal ID → external ID
    const externalIds = await this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Product, productId);
    const prestashopProductId = externalIds.find(
      (e: { connectionId: string }) => e.connectionId === this.connection.id
    );

    if (!prestashopProductId) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
      const error = new PrestashopResourceNotFoundException(
        `Product not found: ${productId} (no external ID mapping for connection ${this.connection.id})`,
        CORE_ENTITY_TYPE.Product,
        productId,
        this.connection.id
      );
      throw error;
    }

    // Fetch product for barcode fallback / synthetic variant
    const prestashopProduct = await this.httpClient.getResource<PrestashopProduct>(
      'products',
      prestashopProductId.externalId
    );

    // Fetch combinations from PrestaShop
    const combinations = await this.httpClient.listResources<PrestashopCombination>(
      'combinations',
      {
        custom: {
          id_product: prestashopProductId.externalId,
        },
      }
    );

    if (combinations.length === 0) {
      const syntheticExternalId = `product:${prestashopProductId.externalId}`;
      const internalId = await this.identifierMapping.getOrCreateInternalId(
        CORE_ENTITY_TYPE.ProductVariant,
        syntheticExternalId,
        this.connection.id,
        {
          parentEntityType: CORE_ENTITY_TYPE.Product,
          parentInternalId: productId,
          metadata: {
            variantExternalId: syntheticExternalId,
            synthetic: true,
          },
        }
      );
      const sku = prestashopProduct.reference ?? `product-${prestashopProductId.externalId}`;
      const productEan = this.normalizeEan(prestashopProduct.ean13);
      const productGtin = this.normalizeGtin(prestashopProduct.upc);

      return [
        {
          id: internalId,
          productId,
          sku,
          attributes: null,
          ean: productEan ?? null,
          gtin: productGtin ?? null,
          // Inherit master price from the parent product so the synthetic
          // variant carries a usable price (simple products are the common
          // case for SMB shops). Null/non-numeric → undefined → surfaces as
          // a `no-master-price` blocker downstream (#792).
          price: this.parseProductPrice(prestashopProduct.price),
        },
      ];
    }

    // Ensure stale synthetic variant mapping is removed once combinations exist
    const syntheticExternalId = `product:${prestashopProductId.externalId}`;
    await this.identifierMapping.deleteMapping(
      CORE_ENTITY_TYPE.ProductVariant,
      syntheticExternalId,
      this.connection.id
    );

    const mappingRequests = combinations.map((c) => ({
      entityType: 'ProductVariant' as const,
      externalId: String(c.id),
      connectionId: this.connection.id,
      context: {
        parentEntityType: CORE_ENTITY_TYPE.Product,
        parentInternalId: productId,
        metadata: {
          variantExternalId: String(c.id),
        },
      },
    }));

    const idMap = await this.identifierMapping.batchGetOrCreateInternalIds(mappingRequests);

    const productEan = this.normalizeEan(prestashopProduct.ean13);
    const productGtin = this.normalizeGtin(prestashopProduct.upc);

    // Resolve the option-value id → semantic-name map so variants carry
    // `{ Color: 'Red' }` instead of positional ids (#1050). A transient options
    // fetch must never break variant sync — on failure we fall back to the
    // positional shape via a null resolver.
    const resolveOptionValue = await this.buildOptionValueResolver();

    // PrestaShop stores a combination's `price` as a price IMPACT (a delta on the
    // product base), not an absolute price — most sellers leave it 0/unset, which
    // previously surfaced `mapped.price = null/0` and a spurious `no-master-price`
    // blocker for every multi-variant product. Resolve the absolute master price
    // = base + impact (impact 0 when unset), mirroring the synthetic-variant
    // inheritance for simple products (#792 / #1096).
    const basePrice = this.parseProductPrice(prestashopProduct.price);

    // Map variants with internal IDs
    return combinations
      .map((combination) => {
        const externalId = String(combination.id);
        const internalId =
          idMap.get(`${externalId}:${this.connection.id}`) || idMap.get(externalId) || '';

        if (!internalId) {
          this.logger.warn(`No internal ID mapped for external variant: ${externalId}`);
          return null;
        }

        const mapped = this.productMapper.mapVariant(combination, productId, resolveOptionValue);
        if (combinations.length === 1) {
          if (!mapped.ean && productEan) {
            mapped.ean = productEan;
          }
          if (!mapped.gtin && productGtin) {
            mapped.gtin = productGtin;
          }
        }
        // `mapped.price` carries the parsed combination impact. Fold it onto the
        // base; fall back to the raw impact only when the product has no base.
        const absolutePrice =
          basePrice !== undefined
            ? Math.round((basePrice + (mapped.price ?? 0)) * 100) / 100
            : mapped.price;
        return {
          ...mapped,
          id: internalId,
          // Conditional so an absent price stays absent (`price?: number` under
          // exactOptionalPropertyTypes rejects an explicit `undefined`).
          ...(absolutePrice !== undefined ? { price: absolutePrice } : {}),
        };
      })
      .filter((v): v is ProductVariant => v !== null);
  }

  /**
   * Build the per-call resolver that turns a combination's
   * `product_option_value` id into `{ groupName, valueName }` (#1050). Returns
   * `undefined` (mapper falls back to the positional shape) when no resolver is
   * wired or the option dictionary can't be fetched — a transient options
   * failure must not break variant sync.
   */
  private async buildOptionValueResolver(): Promise<OptionValueResolver | undefined> {
    if (!this.attributeResolver) {
      return undefined;
    }
    try {
      const optionMap = await this.attributeResolver.getOptionValueMap(
        this.connection.id,
        this.httpClient,
        (field, langId) => this.productMapper.localizeField(field, langId),
        this.resolveLangId()
      );
      return (optionValueId: string) => optionMap.get(optionValueId) ?? null;
    } catch (error) {
      this.logger.warn(
        `Failed to resolve PrestaShop option values (connection: ${this.connection.id}); ` +
          `falling back to positional variant attributes: ${(error as Error).message}`
      );
      return undefined;
    }
  }

  /**
   * Resolve the connection's preferred language id for localized reads,
   * supporting both `preferredLanguageId` (current) and `langId` (deprecated),
   * defaulting to 1. Single source for product, product-list, and attribute
   * localization so all three agree on language.
   */
  private resolveLangId(): number {
    const config = this.connection.config as unknown as PrestashopConnectionConfig;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- prestashop connection config is dynamically shaped; narrowed to number | undefined here
    const configLangId: number | undefined = config.preferredLanguageId ?? config.langId;
    return configLangId ?? 1;
  }

  private normalizeEan(value?: string | null): string | null {
    return normalizeToEan13(value ?? null);
  }

  private normalizeGtin(value?: string | null): string | null {
    return normalizeBarcode(value ?? null);
  }

  /**
   * Parse the PrestaShop product `price` field into a domain number.
   * Mirrors `PrestashopProductMapper.parseNumber` semantics — returns
   * `undefined` for null / undefined / non-finite values so the
   * downstream `no-master-price` blocker can surface accurately. Inlined
   * here (rather than reusing the mapper's private `parseNumber`) to
   * avoid widening the mapper's public interface for one call site.
   */
  private parseProductPrice(value: string | number | undefined | null): number | undefined {
    if (value === undefined || value === null) return undefined;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : undefined;
  }

  // Write operations - not supported in MVP
  createProduct(_product: ProductCreate): Promise<Product> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
    const error = new PrestashopNotSupportedException(
      'Product creation is not supported in MVP. Use PrestaShop admin interface or future write-capability adapter.',
      'createProduct',
      'PrestaShop admin interface'
    );
    return Promise.reject(error);
  }

  updateProduct(_productId: string, _product: ProductUpdate): Promise<Product> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
    const error = new PrestashopNotSupportedException(
      'Product update is not supported in MVP. Use PrestaShop admin interface or future write-capability adapter.',
      'updateProduct',
      'PrestaShop admin interface'
    );
    return Promise.reject(error);
  }

  deleteProduct(_productId: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
    const error = new PrestashopNotSupportedException(
      'Product deletion is not supported in MVP. Use PrestaShop admin interface or future write-capability adapter.',
      'deleteProduct',
      'PrestaShop admin interface'
    );
    return Promise.reject(error);
  }

  upsertProductVariant(
    _productId: string,
    _variant: ProductVariantCreate
  ): Promise<ProductVariant> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
    const error = new PrestashopNotSupportedException(
      'Variant creation/update is not supported in MVP. Use PrestaShop admin interface or future write-capability adapter.',
      'upsertProductVariant',
      'PrestaShop admin interface'
    );
    return Promise.reject(error);
  }

  getProductCategories(_productId: string): Promise<Category[]> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
    const error = new PrestashopNotSupportedException(
      'Get product categories is not implemented in MVP.',
      'getProductCategories',
      'Future implementation'
    );
    return Promise.reject(error);
  }

  assignCategories(_productId: string, _categoryIds: string[]): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
    const error = new PrestashopNotSupportedException(
      'Category assignment is not supported in MVP. Use PrestaShop admin interface or future write-capability adapter.',
      'assignCategories',
      'PrestaShop admin interface'
    );
    return Promise.reject(error);
  }

  async getCategories(): Promise<Category[]> {
    this.logger.debug(`Fetching all categories (connection: ${this.connection.id})`);

    const raw = await this.httpClient.listResources<Record<string, unknown>>('categories');

    const langId = this.getLangId();

    return raw
      .map((cat) => {
        const id = String(cat['id'] ?? '');
        const nameField = cat['name'];
        let name = `Category ${id}`;
        if (typeof nameField === 'string') {
          name = nameField;
        } else if (Array.isArray(nameField)) {
          const lang = (
            nameField as Array<{ language?: Array<{ attrs?: { id: string }; value: string }> }>
          )
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
      })
      .filter((c) => Number(c.depth) > 0); // Exclude root node
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
