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
import { IProductsService } from './products.service.interface';
import { ProductRepositoryPort } from '@openlinker/core/products/domain/ports/product-repository.port';
import { ProductVariantRepositoryPort } from '@openlinker/core/products/domain/ports/product-variant-repository.port';
import { Product } from '@openlinker/core/products/domain/entities/product.entity';
import { ProductVariant } from '@openlinker/core/products/domain/entities/product-variant.entity';
import { Logger } from '@openlinker/shared/logging';
import { PRODUCT_REPOSITORY_TOKEN, PRODUCT_VARIANT_REPOSITORY_TOKEN } from '../../products.tokens';

@Injectable()
export class ProductsService implements IProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @Inject(PRODUCT_REPOSITORY_TOKEN)
    private readonly productRepository: ProductRepositoryPort,
    @Inject(PRODUCT_VARIANT_REPOSITORY_TOKEN)
    private readonly variantRepository: ProductVariantRepositoryPort,
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
          `Variant ${variant.id} has productId ${variant.productId}, expected ${productId}. Updating.`,
        );
        return new ProductVariant(
          variant.id,
          productId,
          variant.sku,
          variant.attributes,
          variant.createdAt,
          variant.updatedAt,
        );
      }
      return variant;
    });

    await this.variantRepository.upsertMany(variantsWithProductId);
    this.logger.debug(`Variants upserted for product: ${productId}`);
  }
}

