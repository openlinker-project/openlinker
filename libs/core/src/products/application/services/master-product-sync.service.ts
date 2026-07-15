/**
 * Master Product Sync Service
 *
 * Core-owned orchestration for syncing product data from a master connection
 * to canonical storage.
 *
 * @module libs/core/src/products/application/services
 */

import { randomUUID } from 'node:crypto';
import { Injectable, Inject } from '@nestjs/common';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { IIdentifierMappingService, IDENTIFIER_MAPPING_SERVICE_TOKEN, CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { EventPublisherPort, EVENT_PUBLISHER_TOKEN } from '@openlinker/core/events';
import { PRODUCTS_SERVICE_TOKEN } from '../../products.tokens';
import { IProductsService } from './products.service.interface';
import type { ProductMasterPort } from '../../domain/ports/product-master.port';
import type { Product } from '../../domain/entities/product.entity';
import type { ProductVariant } from '../../domain/entities/product-variant.entity';
import { MasterProductNotFoundError } from '../../domain/exceptions/master-product-not-found.error';
import {
  MASTER_DELETION_EVENT_STREAM,
  MASTER_DELETION_EVENT_SCHEMA_VERSION,
  MASTER_PRODUCT_STALE_EVENT,
  MASTER_VARIANT_STALE_EVENT,
  type MasterDeletionEventPayload,
} from '../../domain/types/master-deletion-events.types';
import { normalizeBarcode, normalizeToEan13 } from '../../domain/utils/barcode-normalization';
import type {
  IMasterProductSyncService,
  MasterProductSyncResult,
} from './master-product-sync.service.interface';
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
    @Inject(EVENT_PUBLISHER_TOKEN)
    private readonly eventPublisher: EventPublisherPort
  ) {}

  async syncFromMasterByExternalId(
    connectionId: string,
    externalId: string
  ): Promise<MasterProductSyncResult> {
    // Resolve internal product ID
    const internalProductId = await this.identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.Product,
      externalId,
      connectionId
    );

    // Resolve ProductMaster adapter
    const productAdapter = await this.integrationsService.getCapabilityAdapter<ProductMasterPort>(
      connectionId,
      'ProductMaster'
    );

    // Pull product and variants from adapter. A master-side deletion surfaces
    // as the neutral MasterProductNotFoundError (adapters translate their 404 at
    // the port boundary, #1599) — distinct from a transient failure, which
    // rethrows unchanged so the job stays retryable.
    let productFromAdapter: Product;
    let variantsFromAdapter: ProductVariant[];
    try {
      productFromAdapter = await productAdapter.getProduct(internalProductId);
      variantsFromAdapter = await productAdapter.getProductVariants(internalProductId);
    } catch (error) {
      if (error instanceof MasterProductNotFoundError) {
        return this.handleMasterDeletion(connectionId, externalId, internalProductId);
      }
      throw error;
    }

    // Convert port -> domain entities
    const product = this.toDomainProduct(productFromAdapter);
    const variants = variantsFromAdapter.map((v) => this.toDomainVariant(v, internalProductId));

    // Upsert into canonical storage (upsert clears any prior staleness on the
    // reappearing variants — see repository toOrmEntity).
    await this.productsService.upsertProduct(product);
    if (variants.length > 0) {
      await this.productsService.upsertVariants(internalProductId, variants);
    }

    // Soft-mark any previously-known variant absent from this master response as
    // stale (#1599 — the products-context counterpart of the inventory prune).
    // Guarded against a false positive: a successful pull returning ZERO variants
    // is ambiguous (a genuinely emptied product vs. a flaky master response), and
    // pruning against an empty keep-set would stale every variant. A real full
    // deletion arrives as MasterProductNotFoundError (handleMasterDeletion) — the
    // authoritative signal — so here we only prune when the master actually
    // enumerated variants, and skip (with a warning) on an empty response.
    let markedStale: string[] = [];
    if (variants.length > 0) {
      markedStale = await this.productsService.markVariantsStaleExcept(
        internalProductId,
        variants.map((v) => v.id)
      );
      if (markedStale.length > 0) {
        await this.publishDeletionEvent(MASTER_VARIANT_STALE_EVENT, {
          connectionId,
          internalProductId,
          variantIds: markedStale,
        });
      }
    } else {
      this.logger.warn(
        `Master product sync returned 0 variants for an existing product — skipping prune to avoid staling all variants on a possibly-transient empty response (connection: ${connectionId}, externalId: ${externalId}, internalProductId: ${internalProductId})`
      );
    }

    this.logger.debug(
      `Master product sync complete (connection: ${connectionId}, externalId: ${externalId}, internalProductId: ${internalProductId}, variants: ${variants.length}, markedStale=${markedStale.length})`
    );

    return {
      internalProductId,
      variantsUpserted: variants.length,
      masterDeleted: false,
    };
  }

  /**
   * Product deleted at the master: mark every one of its variants stale (empty
   * keep-set), emit `master.product.stale`, and signal a business failure so
   * the handler does NOT retry a permanent condition (#1599, ADR-007).
   */
  private async handleMasterDeletion(
    connectionId: string,
    externalId: string,
    internalProductId: string
  ): Promise<MasterProductSyncResult> {
    const markedStale = await this.productsService.markVariantsStaleExcept(internalProductId, []);
    if (markedStale.length > 0) {
      await this.publishDeletionEvent(MASTER_PRODUCT_STALE_EVENT, {
        connectionId,
        internalProductId,
        variantIds: markedStale,
      });
    }
    this.logger.warn(
      `Master product deleted — marked variants stale (connection: ${connectionId}, externalId: ${externalId}, internalProductId: ${internalProductId}, markedStale=${markedStale.length})`
    );
    return {
      internalProductId,
      variantsUpserted: 0,
      masterDeleted: true,
    };
  }

  private async publishDeletionEvent(
    eventType: typeof MASTER_VARIANT_STALE_EVENT | typeof MASTER_PRODUCT_STALE_EVENT,
    payload: MasterDeletionEventPayload
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.eventPublisher.publish(MASTER_DELETION_EVENT_STREAM, {
      eventId: randomUUID(),
      eventType,
      payloadJson: JSON.stringify(payload),
      metadataJson: JSON.stringify({ schemaVersion: MASTER_DELETION_EVENT_SCHEMA_VERSION }),
      occurredAt: now,
      publishedAt: now,
    });
  }

  /**
   * Normalize adapter-produced product: coerce nullable fields to null.
   *
   * Adapters may omit createdAt/updatedAt — the repository populates them on
   * save via TypeORM's @CreateDateColumn/@UpdateDateColumn. Master-derived
   * fields spread through untouched; `currency` and `categories` (#1034) are
   * persisted by the repository, while `weight` remains intentionally transient
   * (no column — master-derived only).
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
