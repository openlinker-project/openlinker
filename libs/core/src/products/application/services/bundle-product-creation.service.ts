/**
 * Bundle Product Creation Service (#3935)
 *
 * Makes a NEW product for a bundle at the chosen product master (through the
 * optional `ProductCreator` capability), then pulls it into OpenLinker with the
 * ordinary master sync so the bundle definition has a variant to attach to.
 * Idempotent on SKU: the first attempt may have created the product and died
 * before OpenLinker recorded it, so a retry looks the SKU up first.
 *
 * @module libs/core/src/products/application/services
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  CapabilityNotSupportedException,
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import { BundleProductCreationRefusedError } from '../../domain/exceptions/bundle-definition.errors';
import type { ProductMasterPort } from '../../domain/ports/product-master.port';
import { isProductCreator } from '../../domain/ports/capabilities/product-creator.capability';
import {
  MASTER_PRODUCT_SYNC_SERVICE_TOKEN,
  PRODUCTS_SERVICE_TOKEN,
} from '../../products.tokens';
import { IMasterProductSyncService } from './master-product-sync.service.interface';
import { IProductsService } from './products.service.interface';
import type {
  BundleCreationTarget,
  CreatedBundleProduct,
  CreateBundleProductInput,
  IBundleProductCreationService,
} from './bundle-product-creation.service.interface';

@Injectable()
export class BundleProductCreationService implements IBundleProductCreationService {
  private readonly logger = new Logger(BundleProductCreationService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(MASTER_PRODUCT_SYNC_SERVICE_TOKEN)
    private readonly masterSync: IMasterProductSyncService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly products: IProductsService
  ) {}

  async listTargets(): Promise<BundleCreationTarget[]> {
    const entries = await this.integrations.listCapabilityAdapters<
      ProductMasterPort | Promise<ProductMasterPort>
    >({ capability: 'ProductMaster', lazy: true });
    const targets: BundleCreationTarget[] = [];
    for (const entry of entries) {
      let creationMode: BundleCreationTarget['creationMode'] = null;
      try {
        const adapter = await entry.adapter;
        creationMode = isProductCreator(adapter) ? adapter.productCreationMode : null;
      } catch (error) {
        this.logger.warn(
          `Could not resolve ProductMaster for ${entry.connectionId}: ${(error as Error).message}`
        );
      }
      targets.push({
        connectionId: entry.connectionId,
        connectionName: entry.connection.name,
        platformType: entry.connection.platformType,
        creationMode,
      });
    }
    return targets;
  }

  async createBundleProduct(input: CreateBundleProductInput): Promise<CreatedBundleProduct> {
    const adapter = await this.resolveCreator(input.connectionId);

    const existing = await this.findBySku(input.connectionId, input.sku);
    let adopted = false;
    let internalProductId: string;
    if (existing !== null) {
      adopted = true;
      internalProductId = existing;
    } else {
      const taxRate = await this.readTaxRate(input.rateSourceVariantId);
      try {
        const created = await adapter.createProduct({
          name: input.name,
          sku: input.sku,
          price: input.price,
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.ean !== undefined ? { ean: input.ean } : {}),
          ...(taxRate !== null ? { taxRate } : {}),
        });
        internalProductId = created.id;
      } catch (error) {
        throw new BundleProductCreationRefusedError(
          'master-refused',
          error instanceof Error ? error.message : 'The master refused the product'
        );
      }
    }

    const mappings = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Product,
      internalProductId
    );
    const mapping = mappings.find((m) => m.connectionId === input.connectionId);
    if (mapping === undefined) {
      throw new BundleProductCreationRefusedError(
        'not-synced',
        'The product was created but OpenLinker has no record of it yet'
      );
    }
    await this.masterSync.syncFromMasterByExternalId(input.connectionId, mapping.externalId);

    const variants = await this.products.getVariantsByProductId(internalProductId);
    const variant = variants[0];
    if (variant === undefined) {
      throw new BundleProductCreationRefusedError(
        'not-synced',
        'The product was created but has not reached OpenLinker yet; try again in a moment'
      );
    }
    return {
      productId: internalProductId,
      variantId: variant.id,
      name: input.name,
      sku: input.sku,
      adopted,
    };
  }

  private async resolveCreator(
    connectionId: string
  ): Promise<ProductMasterPort & { readonly productCreationMode: 'simple-product' }> {
    let adapter: ProductMasterPort;
    try {
      adapter = await this.integrations.getCapabilityAdapter<ProductMasterPort>(
        connectionId,
        'ProductMaster'
      );
    } catch (error) {
      if (error instanceof CapabilityNotSupportedException) {
        throw new BundleProductCreationRefusedError(
          'master-cannot-create-products',
          'This connection is not a product master'
        );
      }
      throw new BundleProductCreationRefusedError(
        'master-unavailable',
        error instanceof Error ? error.message : 'The product master could not be reached'
      );
    }
    if (!isProductCreator(adapter)) {
      throw new BundleProductCreationRefusedError(
        'master-cannot-create-products',
        'This product master cannot create products from OpenLinker'
      );
    }
    return adapter;
  }

  private async readTaxRate(variantId: string | undefined): Promise<string | null> {
    if (variantId === undefined) return null;
    const variant = await this.products.getVariant(variantId);
    if (variant === null) return null;
    const rate = await this.products.getEffectiveTaxRate(variant.productId, variantId);
    return rate.code !== null && rate.code.trim() !== '' ? rate.code : null;
  }

  /** The internal product id already mapped on this connection under this SKU, if any. */
  private async findBySku(connectionId: string, sku: string): Promise<string | null> {
    const variants = await this.products.getVariantsBySkus([sku]);
    for (const variant of variants) {
      const mappings = await this.identifierMapping.getExternalIds(
        CORE_ENTITY_TYPE.Product,
        variant.productId
      );
      if (mappings.some((m) => m.connectionId === connectionId)) return variant.productId;
    }
    return null;
  }
}
