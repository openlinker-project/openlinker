/**
 * Product Publish Execution Service
 *
 * Owns the orchestration policy for publishing a product onto a shop destination
 * (OL → WooCommerce / Shopify, #1042, ADR-024). The `shop.product.publish`
 * worker handler and the future REST endpoint (#1044) both delegate here so
 * publish semantics stay in one place (architecture-overview.md §6).
 *
 * Flow:
 *   1. Load or create the ListingCreationRecord.
 *   2. Resolve create-vs-upsert: look up the `ShopProduct` IdentifierMapping for
 *      this (variant, connection) → set `externalProductId` for an upsert.
 *   3. Build the neutral PublishProductCommand (ProductPublishBuilderService).
 *   4. Resolve the shop adapter and call `publishProduct`.
 *   5. On first publish, persist the IdentifierMapping (idempotent on retry).
 *   6. Update the record with externalProductId + final status.
 *
 * Terminal domain failures (builder validation, master-catalog misconfig, shop
 * reject) are caught and recorded as `status='failed'`; the method resolves
 * normally so the worker runner treats the job as succeeded and does not retry.
 * Transient / unknown errors propagate.
 *
 * Concurrency: two concurrent *first* publishes of the same variant create two
 * distinct shop products (shop create is not platform-idempotent; the mapping
 * records one). Bounded by the job-level `idempotencyKey` dedup (#726
 * at-most-once enqueue) — the enqueue gate is the guard, not a DB constraint.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IProductPublishExecutionService}
 */

import { Inject, Injectable } from '@nestjs/common';

import {
  CORE_ENTITY_TYPE,
  DuplicateIdentifierMappingError,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type {
  CreateOfferValidationError,
  PublishProductCommand,
  PublishProductResult,
  ShopProductManagerPort,
} from '@openlinker/core/listings';
import { ProductPublishRejectedException } from '@openlinker/core/listings';
import type { JobOutcome } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import type { ListingCreationRecord } from '../../domain/entities/listing-creation-record.entity';
import { ListingCreationInvariantException } from '../../domain/exceptions/listing-creation-invariant.exception';
import { ListingCreationRecordNotFoundException } from '../../domain/exceptions/listing-creation-record-not-found.exception';
import { MasterCatalogConnectionNotConfiguredException } from '../../domain/exceptions/master-catalog-connection-not-configured.exception';
import type { ProductPublishBuilderValidationIssue } from '../../domain/exceptions/product-publish-builder-validation.exception';
import { ProductPublishBuilderValidationException } from '../../domain/exceptions/product-publish-builder-validation.exception';
import { ListingCreationRecordRepositoryPort } from '../../domain/ports/listing-creation-record-repository.port';
import {
  LISTING_CREATION_STATUS,
  type ListingCreationError,
} from '../../domain/types/listing-creation-record.types';
import {
  LISTING_CREATION_RECORD_REPOSITORY_TOKEN,
  PRODUCT_PUBLISH_BUILDER_SERVICE_TOKEN,
} from '../../listings.tokens';
import { IProductPublishBuilderService } from '../interfaces/product-publish-builder.service.interface';
import type { IProductPublishExecutionService } from '../interfaces/product-publish-execution.service.interface';
import type {
  ExecutePublishProductInput,
  ExecutePublishProductResult,
} from '../types/product-publish-execution.types';

@Injectable()
export class ProductPublishExecutionService implements IProductPublishExecutionService {
  private readonly logger = new Logger(ProductPublishExecutionService.name);

  constructor(
    @Inject(PRODUCT_PUBLISH_BUILDER_SERVICE_TOKEN)
    private readonly builder: IProductPublishBuilderService,
    @Inject(LISTING_CREATION_RECORD_REPOSITORY_TOKEN)
    private readonly listingRecords: ListingCreationRecordRepositoryPort,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService
  ) {}

  async executePublish(input: ExecutePublishProductInput): Promise<ExecutePublishProductResult> {
    const record = await this.loadOrCreateRecord(input);

    // Create-vs-upsert: the `ShopProduct` mapping is keyed (entityType,
    // internalId) on the reverse lookup, so filter by connectionId to get
    // *this* shop's external product id.
    const existingExternalProductId = await this.resolveExistingExternalProductId(input);

    let command: PublishProductCommand;
    try {
      command = await this.builder.buildPublishProductCommand({
        internalVariantId: input.internalVariantId,
        connectionId: input.connectionId,
        stock: input.stock,
        status: input.status,
        price: input.price,
        content: input.content,
        idempotencyKey: input.idempotencyKey,
      });
    } catch (error) {
      const terminal = this.mapBuilderException(error);
      if (terminal) {
        const updated = await this.listingRecords.updateStatus(
          record.id,
          LISTING_CREATION_STATUS.Failed,
          terminal
        );
        return this.buildResult(updated, input.connectionId);
      }
      throw error;
    }

    if (existingExternalProductId) {
      command = { ...command, externalProductId: existingExternalProductId };
    }

    const adapter = await this.integrationsService.getCapabilityAdapter<ShopProductManagerPort>(
      input.connectionId,
      'ProductPublisher'
    );

    let result: PublishProductResult;
    try {
      result = await adapter.publishProduct(command);
    } catch (error) {
      if (error instanceof ProductPublishRejectedException) {
        const updated = await this.listingRecords.updateStatus(
          record.id,
          LISTING_CREATION_STATUS.Failed,
          this.mapRejectionErrors(error)
        );
        return this.buildResult(updated, input.connectionId);
      }
      throw error;
    }

    // First publish only — persist the variant → external-product mapping.
    // Upserts already have it. `DuplicateIdentifierMappingError` means a prior
    // attempt inserted it; that is exactly what we wanted, so continue.
    if (!existingExternalProductId) {
      try {
        await this.identifierMapping.createMapping(
          CORE_ENTITY_TYPE.ShopProduct,
          result.externalProductId,
          input.connectionId,
          input.internalVariantId
        );
      } catch (error) {
        if (!(error instanceof DuplicateIdentifierMappingError)) {
          throw error;
        }
      }
    }

    const finalRecord = await this.listingRecords.updateExternalIdAndStatus(
      record.id,
      result.externalProductId,
      result.status,
      null
    );
    return this.buildResult(finalRecord, input.connectionId);
  }

  private async resolveExistingExternalProductId(
    input: ExecutePublishProductInput
  ): Promise<string | null> {
    const mappings = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.ShopProduct,
      input.internalVariantId
    );
    const forConnection = mappings.find((m) => m.connectionId === input.connectionId);
    return forConnection?.externalId ?? null;
  }

  private async loadOrCreateRecord(
    input: ExecutePublishProductInput
  ): Promise<ListingCreationRecord> {
    if (input.listingCreationRecordId) {
      const existing = await this.listingRecords.findById(input.listingCreationRecordId);
      if (!existing) {
        throw new ListingCreationRecordNotFoundException(input.listingCreationRecordId);
      }
      return existing;
    }
    return this.listingRecords.create({
      internalVariantId: input.internalVariantId,
      connectionId: input.connectionId,
      status: LISTING_CREATION_STATUS.Pending,
      externalProductId: null,
      errors: null,
    });
  }

  /**
   * Map an `ListingCreationRecord` to its `JobOutcome`. `published`/`draft` →
   * `ok` (the publish itself succeeded); `failed` → `business_failure`. A final
   * `pending` is an unreachable invariant.
   */
  private recordToOutcome(record: ListingCreationRecord): JobOutcome {
    switch (record.status) {
      case LISTING_CREATION_STATUS.Failed:
        return 'business_failure';
      case LISTING_CREATION_STATUS.Published:
      case LISTING_CREATION_STATUS.Draft:
        return 'ok';
      case LISTING_CREATION_STATUS.Pending:
        throw new ListingCreationInvariantException(record.id, record.status);
      default: {
        const _exhaustive: never = record.status;
        return _exhaustive;
      }
    }
  }

  private buildResult(
    record: ListingCreationRecord,
    connectionId: string
  ): ExecutePublishProductResult {
    const outcome = this.recordToOutcome(record);
    if (outcome === 'business_failure') {
      this.logger.warn(
        `Product publish recorded business_failure. recordId=${record.id} connectionId=${connectionId} errorCount=${record.errors?.length ?? 0}`
      );
    }
    return { listingCreationRecord: record, outcome };
  }

  private mapBuilderException(error: unknown): ListingCreationError[] | null {
    if (error instanceof ProductPublishBuilderValidationException) {
      return error.issues.map((issue: ProductPublishBuilderValidationIssue) => ({
        field: issue.field,
        code: issue.code,
        message: issue.message,
      }));
    }
    if (error instanceof MasterCatalogConnectionNotConfiguredException) {
      // Re-word channel-neutral for the shop record — the shared exception's
      // message is marketplace/offer-worded (reused from the offer path).
      return [
        {
          field: 'connection.config.masterCatalogConnectionId',
          code: 'MASTER_CATALOG_NOT_CONFIGURED',
          message: `Shop connection ${error.marketplaceConnectionId} has no masterCatalogConnectionId configured; cannot resolve master product data to publish`,
        },
      ];
    }
    return null;
  }

  private mapRejectionErrors(error: ProductPublishRejectedException): ListingCreationError[] {
    return error.errors.map((e: CreateOfferValidationError) => ({
      field: e.field,
      code: e.code,
      message: e.message,
    }));
  }
}
