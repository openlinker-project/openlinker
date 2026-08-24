/**
 * Products Service
 *
 * Application service for product operations. Provides product and variant
 * upsert capabilities. Works with internal IDs only; IdentifierMapping is
 * handled by handlers, not by this service.
 *
 * @module libs/core/src/products/application/services
 * @implements {IProductsService}
 * @see {@link IProductsService} for the service interface
 * @see {@link ProductRepositoryPort} for persistence port
 * @see {@link ProductVariantRepositoryPort} for variant persistence port
 */
import { Injectable, Inject } from '@nestjs/common';
import type { IProductsService } from './products.service.interface';
import { ProductRepositoryPort } from '../../domain/ports/product-repository.port';
import { ProductVariantRepositoryPort } from '../../domain/ports/product-variant-repository.port';
import type { Product } from '../../domain/entities/product.entity';
import type { ProductVariant } from '../../domain/entities/product-variant.entity';
import type {
  ProductListFilters,
  ProductVariantListFilters,
  ProductPagination,
  ProductListSort,
  PaginatedProducts,
  PaginatedProductVariants,
} from '../../domain/types/product.types';
import type { StoredTaxRate } from '../../domain/types/tax-rate.types';
import { effectiveTaxRate } from '../../domain/types/tax-rate.types';
import type {
  ConnectionTaxRateCoverage,
  TaxRateCoverage,
} from '../../domain/types/tax-rate-coverage.types';
import { Logger } from '@openlinker/shared/logging';
import { PRODUCT_REPOSITORY_TOKEN, PRODUCT_VARIANT_REPOSITORY_TOKEN } from '../../products.tokens';

@Injectable()
export class ProductsService implements IProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @Inject(PRODUCT_REPOSITORY_TOKEN)
    private readonly productRepository: ProductRepositoryPort,
    @Inject(PRODUCT_VARIANT_REPOSITORY_TOKEN)
    private readonly variantRepository: ProductVariantRepositoryPort
  ) {}

  async upsertProduct(product: Product): Promise<Product> {
    this.logger.debug(`Upserting product: ${product.id}`);
    const upserted = await this.productRepository.upsert(product);
    this.logger.debug(`Product upserted: ${upserted.id}`);
    return upserted;
  }

  async upsertVariants(productId: string, variants: ProductVariant[]): Promise<void> {
    if (variants.length === 0) {
      this.logger.debug(`No variants to upsert for product: ${productId}`);
      return;
    }

    this.logger.debug(`Upserting ${variants.length} variants for product: ${productId}`);

    // Ensure all variants have the correct productId
    const variantsWithProductId = variants.map((variant) => {
      if (variant.productId !== productId) {
        this.logger.warn(
          `Variant ${variant.id} has productId ${variant.productId}, expected ${productId}. Updating.`
        );
        return { ...variant, productId };
      }
      return variant;
    });

    await this.variantRepository.upsertMany(variantsWithProductId);
    this.logger.debug(`Variants upserted for product: ${productId}`);
  }

  async recordProductTaxRate(productId: string, rate: StoredTaxRate): Promise<void> {
    await this.productRepository.recordTaxRate(productId, rate);
  }

  async recordVariantTaxRate(variantId: string, rate: StoredTaxRate): Promise<void> {
    await this.variantRepository.recordTaxRate(variantId, rate);
  }

  async clearVariantTaxRate(variantId: string): Promise<void> {
    await this.variantRepository.clearTaxRate(variantId);
  }

  /**
   * The rate that applies to a line (#2054).
   *
   * The variant override is read first and wins where the shop carries one -
   * it is the more specific statement of the same fact, not a conflict to
   * arbitrate. An absent override means "no opinion", never "no rate", so a
   * product-keyed master (PrestaShop) resolves through the product row
   * unchanged.
   */
  async getEffectiveTaxRate(productId: string, variantId?: string): Promise<StoredTaxRate> {
    const [productRate, variantRate] = await Promise.all([
      this.productRepository.findTaxRate(productId),
      variantId ? this.variantRepository.findTaxRate(variantId) : Promise.resolve(null),
    ]);
    return effectiveTaxRate(productRate, variantRate);
  }

  async getTaxRateCoverage(): Promise<TaxRateCoverage> {
    return this.productRepository.countTaxRateStates();
  }

  async getTaxRateCoverageByConnection(): Promise<ConnectionTaxRateCoverage[]> {
    return this.productRepository.countTaxRateStatesByConnection();
  }

  async getProduct(id: string): Promise<Product | null> {
    return this.productRepository.findById(id);
  }

  async getProductsByIds(ids: string[]): Promise<Product[]> {
    if (ids.length === 0) return [];
    return this.productRepository.findByIds(ids);
  }

  async getVariant(id: string): Promise<ProductVariant | null> {
    return this.variantRepository.findById(id);
  }

  async getVariantsByProductId(productId: string): Promise<ProductVariant[]> {
    return this.variantRepository.findByProductId(productId);
  }

  async getVariantsByProductIds(productIds: readonly string[]): Promise<ProductVariant[]> {
    return this.variantRepository.findByProductIds(productIds);
  }

  async getVariantsBySkus(skus: string[]): Promise<ProductVariant[]> {
    if (skus.length === 0) return [];
    return this.variantRepository.findBySkuIn(skus);
  }

  async getVariantsByIds(ids: readonly string[]): Promise<ProductVariant[]> {
    if (ids.length === 0) return [];
    return this.variantRepository.findByIdIn(ids);
  }

  async getVariantsByBarcodes(
    connectionId: string,
    values: string[],
    field: 'ean' | 'gtin'
  ): Promise<ProductVariant[]> {
    if (values.length === 0) return [];
    return this.variantRepository.findByEanOrGtinIn(connectionId, values, field);
  }

  async listProducts(
    filters: ProductListFilters,
    pagination: ProductPagination,
    sort?: ProductListSort
  ): Promise<PaginatedProducts> {
    return this.productRepository.findMany(filters, pagination, sort);
  }

  async getVariantCountsByProductIds(productIds: readonly string[]): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    return this.variantRepository.countByProductIds(productIds);
  }

  async listVariants(
    filters: ProductVariantListFilters,
    pagination: ProductPagination
  ): Promise<PaginatedProductVariants> {
    return this.variantRepository.findMany(filters, pagination);
  }

  async markVariantsStaleExcept(
    productId: string,
    keepVariantIds: readonly string[]
  ): Promise<string[]> {
    const marked = await this.variantRepository.markStaleExceptVariants(productId, keepVariantIds);
    if (marked.length > 0) {
      this.logger.warn(
        `products_prune_marked_stale (productId: ${productId}, markedStale=${marked.length}, kept=${keepVariantIds.length})`
      );
    }
    return marked;
  }
}
