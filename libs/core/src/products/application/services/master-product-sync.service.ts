/**
 * Master Product Sync Service
 *
 * Core-owned orchestration for syncing product data from a master connection
 * to canonical storage.
 *
 * @module libs/core/src/products/application/services
 */

import { Injectable, Inject } from '@nestjs/common';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import {
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
} from '@openlinker/core/identifier-mapping';
import { PRODUCTS_SERVICE_TOKEN } from '../../products.tokens';
import { IProductsService } from './products.service.interface';
import { ProductMasterPort, Product as ProductPortInterface, ProductVariant as ProductVariantPortInterface } from '../../domain/ports/product-master.port';
import { Product as ProductDomainEntity } from '../../domain/entities/product.entity';
import { ProductVariant as ProductVariantDomainEntity } from '../../domain/entities/product-variant.entity';
import { normalizeBarcode, normalizeToEan13 } from '../../domain/utils/barcode-normalization';
import { IMasterProductSyncService, MasterProductSyncResult } from './master-product-sync.service.interface';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class MasterProductSyncService implements IMasterProductSyncService {
  private readonly logger = new Logger(MasterProductSyncService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
  ) {}

  async syncFromMasterByExternalId(
    connectionId: string,
    externalId: string,
  ): Promise<MasterProductSyncResult> {
    // Resolve internal product ID
    const internalProductId = await this.identifierMapping.getOrCreateInternalId(
      'Product',
      externalId,
      connectionId,
    );

    // Resolve ProductMaster adapter
    const productAdapter = await this.integrationsService.getCapabilityAdapter<ProductMasterPort>(
      connectionId,
      'ProductMaster',
    );

    // Pull product and variants from adapter
    const productFromAdapter = await productAdapter.getProduct(internalProductId);
    const variantsFromAdapter = await productAdapter.getProductVariants(internalProductId);

    // Convert port -> domain entities
    const product = this.toDomainProduct(productFromAdapter);
    const variants = variantsFromAdapter.map((v) => this.toDomainVariant(v, internalProductId));

    // Upsert into canonical storage
    await this.productsService.upsertProduct(product);
    if (variants.length > 0) {
      await this.productsService.upsertVariants(internalProductId, variants);
    }

    this.logger.debug(
      `Master product sync complete (connection: ${connectionId}, externalId: ${externalId}, internalProductId: ${internalProductId}, variants: ${variants.length})`,
    );

    return {
      internalProductId,
      variantsUpserted: variants.length,
    };
  }

  /**
   * Convert port Product to domain Product entity.
   *
   * Uses nullish coalescing (??) to preserve falsy values like 0.
   */
  private toDomainProduct(product: ProductPortInterface): ProductDomainEntity {
    return new ProductDomainEntity(
      product.id,
      product.name,
      product.sku ?? null,
      product.price ?? null,
      product.description ?? null,
      product.images ?? null,
      product.createdAt ?? new Date(),
      product.updatedAt ?? new Date(),
    );
  }

  /**
   * Convert port ProductVariant to domain ProductVariant entity.
   */
  private toDomainVariant(
    variant: ProductVariantPortInterface,
    productId: string,
  ): ProductVariantDomainEntity {
    const ean = normalizeToEan13(variant.ean ?? null);
    const gtin = normalizeBarcode(variant.gtin ?? null);

    return new ProductVariantDomainEntity(
      variant.id,
      productId,
      variant.sku ?? null,
      variant.attributes ?? null,
      new Date(),
      new Date(),
      ean,
      gtin,
    );
  }
}

