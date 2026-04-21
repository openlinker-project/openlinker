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
import { ProductMasterPort } from '../../domain/ports/product-master.port';
import { Product } from '../../domain/entities/product.entity';
import { ProductVariant } from '../../domain/entities/product-variant.entity';
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
   * Normalize adapter-produced product: coerce nullable fields to null.
   *
   * Adapters may omit createdAt/updatedAt — the repository populates them on
   * save via TypeORM's @CreateDateColumn/@UpdateDateColumn. Master-derived
   * fields (currency/weight/categories) spread through untouched; the ORM
   * has no columns for them, so they're silently dropped on persist.
   */
  private toDomainProduct(product: Product): Product {
    return {
      ...product,
      sku: product.sku ?? null,
      price: product.price ?? null,
      description: product.description ?? null,
      images: product.images ?? null,
    };
  }

  /**
   * Normalize adapter-produced variant: coerce barcode fields and pin productId.
   *
   * Adapters may omit createdAt/updatedAt — the repository populates them on
   * save via TypeORM's @CreateDateColumn/@UpdateDateColumn.
   */
  private toDomainVariant(variant: ProductVariant, productId: string): ProductVariant {
    return {
      ...variant,
      productId,
      sku: variant.sku ?? null,
      attributes: variant.attributes ?? null,
      ean: normalizeToEan13(variant.ean ?? null),
      gtin: normalizeBarcode(variant.gtin ?? null),
    };
  }
}

