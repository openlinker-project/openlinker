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
  PaginatedProducts,
  PaginatedProductVariants,
} from '../../domain/types/product.types';
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

  async getVariantsBySkus(skus: string[]): Promise<ProductVariant[]> {
    if (skus.length === 0) return [];
    return this.variantRepository.findBySkuIn(skus);
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
    pagination: ProductPagination
  ): Promise<PaginatedProducts> {
    return this.productRepository.findMany(filters, pagination);
  }

  async listVariants(
    filters: ProductVariantListFilters,
    pagination: ProductPagination
  ): Promise<PaginatedProductVariants> {
    return this.variantRepository.findMany(filters, pagination);
  }
}
