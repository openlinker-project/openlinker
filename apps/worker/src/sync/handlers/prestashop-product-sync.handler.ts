/**
 * PrestaShop Product Sync Handler
 *
 * Handles sync jobs of type 'prestashop.product.syncByExternalId'.
 * Pulls product and variant data from PrestaShop via ProductMaster adapter
 * and upserts to canonical storage.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import {
  SyncJobHandler,
  SyncJob as SyncJobEntity,
  SyncJobExecutionError,
} from '@openlinker/core/sync';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import {
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
} from '@openlinker/core/identifier-mapping';
import {
  IProductsService,
  PRODUCTS_SERVICE_TOKEN,
  ProductMasterPort,
  Product as ProductPortInterface,
  ProductVariant as ProductVariantPortInterface,
  ProductEntity as ProductDomainEntity,
} from '@openlinker/core/products';

type SyncJob = SyncJobEntity;
import { ProductVariantEntity as ProductVariantDomainEntity } from '@openlinker/core/products';
import {
  PrestashopResourceNotFoundException,
  PrestashopAuthenticationException,
} from '@openlinker/integrations-prestashop';
import { Logger } from '@openlinker/shared/logging';

/**
 * PrestaShop Product Sync Handler
 *
 * Implements SyncJobHandler for 'prestashop.product.syncByExternalId' jobs.
 * Workflow:
 * 1. Validate payload (externalId, objectType, eventType)
 * 2. Resolve internal product ID via IdentifierMappingService
 * 3. Resolve ProductMaster adapter via IntegrationsService
 * 4. Pull product and variants from adapter (using internal ID)
 * 5. Upsert product and variants to canonical storage
 */
@Injectable()
export class PrestashopProductSyncHandler implements SyncJobHandler {
  private readonly logger = new Logger(PrestashopProductSyncHandler.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
  ) {}

  async execute(job: SyncJob): Promise<void> {
    // Extract externalId early for use in error messages and logging
    let externalId: string;
    try {
      externalId = this.getExternalId(job);
    } catch (error) {
      // If externalId extraction fails, re-throw (already wrapped in SyncJobExecutionError)
      throw error;
    }

    this.logger.log(
      `Executing product sync job ${job.id} for connection ${job.connectionId} (externalId: ${externalId})`,
    );

    try {
      // Step 1: Validate payload
      const objectType = this.getObjectType(job);

      if (objectType !== 'Product') {
        throw new SyncJobExecutionError(
          `Invalid objectType for product sync: ${objectType}. Expected 'Product'.`,
          job.id,
          job.jobType,
          job.connectionId,
        );
      }

      // Step 2: Resolve internal product ID
      const internalProductId = await this.identifierMapping.getOrCreateInternalId(
        'Product',
        externalId,
        job.connectionId,
      );

      this.logger.debug(
        `Resolved internal product ID: ${internalProductId} for external ID: ${externalId}`,
      );

      // Step 3: Resolve ProductMaster adapter
      const productAdapter = await this.integrationsService.getCapabilityAdapter<ProductMasterPort>(
        job.connectionId,
        'ProductMaster',
      );

      // Step 4: Pull product from adapter (using internal ID)
      const productFromAdapter = await productAdapter.getProduct(internalProductId);

      // DEBUG: Log what we got from the adapter
      this.logger.debug(`Product from adapter:`, {
        id: productFromAdapter.id,
        name: productFromAdapter.name || 'EMPTY',
        description: productFromAdapter.description ? 'PRESENT' : 'NULL/UNDEFINED',
        images: productFromAdapter.images ? `Array(${productFromAdapter.images.length})` : 'NULL/UNDEFINED',
        sku: productFromAdapter.sku || 'EMPTY',
        price: productFromAdapter.price,
      });

      // Step 5: Pull variants from adapter (using internal ID)
      const variantsFromAdapter = await productAdapter.getProductVariants(internalProductId);

      // Step 6: Convert port Product to domain Product entity
      const product = this.toDomainProduct(productFromAdapter);

      // DEBUG: Log what we're about to save
      this.logger.debug(`Domain product before upsert:`, {
        id: product.id,
        name: product.name || 'EMPTY',
        description: product.description ? 'PRESENT' : 'NULL',
        images: product.images ? `Array(${product.images.length})` : 'NULL',
        sku: product.sku || 'EMPTY',
        price: product.price,
      });

      // Step 7: Convert port ProductVariant[] to domain ProductVariant[] entities
      const variants = variantsFromAdapter.map((v) => this.toDomainVariant(v, internalProductId));

      // Step 8: Upsert product to canonical storage
      await this.productsService.upsertProduct(product);

      // Step 9: Upsert variants to canonical storage
      if (variants.length > 0) {
        await this.productsService.upsertVariants(internalProductId, variants);
        this.logger.debug(`Upserted ${variants.length} variant(s) for product ${internalProductId}`);
      }

      this.logger.log(
        `Product sync completed for job ${job.id} (product: ${internalProductId}, variants: ${variants.length})`,
      );
    } catch (error) {
      // Re-throw SyncJobExecutionError as-is (already wrapped)
      if (error instanceof SyncJobExecutionError) {
        throw error;
      }

      // Handle non-retryable errors (permanent failures)
      if (error instanceof PrestashopResourceNotFoundException) {
        // Product not found (404) - permanent failure, should not retry
        // The runner will mark as dead after maxAttempts, but we provide clear error message
        throw new SyncJobExecutionError(
          `Product not found: ${error.message} (externalId: ${externalId})`,
          job.id,
          job.jobType,
          job.connectionId,
          error,
        );
      }

      if (error instanceof PrestashopAuthenticationException) {
        // Authentication failure (401) - requires manual intervention
        throw new SyncJobExecutionError(
          `Authentication failed: ${error.message} (connection: ${job.connectionId})`,
          job.id,
          job.jobType,
          job.connectionId,
          error,
        );
      }

      // Other errors are retryable (network, 5xx, etc.)
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Product sync failed for externalId ${externalId} (connection: ${job.connectionId}): ${errorMessage}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Extract externalId from job payload
   */
  private getExternalId(job: SyncJob): string {
    const externalId = job.payload?.externalId;
    if (externalId === undefined || externalId === null || typeof externalId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid externalId in job payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }
    return externalId;
  }

  /**
   * Extract objectType from job payload
   */
  private getObjectType(job: SyncJob): string {
    const objectType = job.payload?.objectType;
    if (objectType === undefined || objectType === null || typeof objectType !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid objectType in job payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }
    return objectType;
  }

  /**
   * Convert port Product to domain Product entity
   *
   * Uses nullish coalescing (??) instead of logical OR (||) to preserve
   * falsy values like 0 (price) and empty string (sku) if they're valid.
   */
  private toDomainProduct(product: ProductPortInterface): ProductDomainEntity {
    return new ProductDomainEntity(
      product.id,
      product.name,
      product.sku ?? null, // Use nullish coalescing to preserve empty string if needed
      product.price ?? null, // Use nullish coalescing to preserve 0 (zero is valid price)
      product.description ?? null,
      product.images ?? null,
      product.createdAt ?? new Date(),
      product.updatedAt ?? new Date(),
    );
  }

  /**
   * Convert port ProductVariant to domain ProductVariant entity
   *
   * Uses nullish coalescing (??) instead of logical OR (||) to preserve
   * falsy values like empty string (sku) if they're valid.
   */
  private toDomainVariant(
    variant: ProductVariantPortInterface,
    productId: string,
  ): ProductVariantDomainEntity {
    return new ProductVariantDomainEntity(
      variant.id,
      productId,
      variant.sku ?? null, // Use nullish coalescing to preserve empty string if needed
      variant.attributes ?? null,
      new Date(), // createdAt (not in port interface)
      new Date(), // updatedAt (not in port interface)
    );
  }
}

