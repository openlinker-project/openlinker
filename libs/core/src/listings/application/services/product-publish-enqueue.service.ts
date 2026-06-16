/**
 * Product Publish Enqueue Service
 *
 * Pre-enqueue orchestration for outbound shop publish (#1044): resolves the
 * `ProductPublisher` adapter (validating connection existence / status /
 * capability), pre-creates the `ListingCreationRecord`, and enqueues the
 * `shop.product.publish` sync job. The shop-side sibling of
 * `OfferCreationEnqueueService`, and the single per-child primitive both the
 * single-publish controller and the bulk submit service (#1044) fan out through.
 *
 * Post-enqueue orchestration (builder + adapter call + mapping persistence)
 * lives in `ProductPublishExecutionService` (#1042), invoked by the worker.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IProductPublishEnqueueService}
 */

import { Inject, Injectable } from '@nestjs/common';

import type { ShopProductManagerPort } from '@openlinker/core/listings';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import {
  JobEnqueuePort,
  JOB_ENQUEUE_TOKEN,
  type ShopProductPublishPayloadV1,
  type ShopProductPublishPayloadV2,
} from '@openlinker/core/sync';

import { ListingCreationRecordRepositoryPort } from '../../domain/ports/listing-creation-record-repository.port';
import { LISTING_CREATION_STATUS } from '../../domain/types/listing-creation-record.types';
import { LISTING_CREATION_RECORD_REPOSITORY_TOKEN } from '../../listings.tokens';
import type { IProductPublishEnqueueService } from '../interfaces/product-publish-enqueue.service.interface';
import type {
  EnqueueProductPublishInput,
  EnqueueProductPublishResult,
} from '../types/product-publish-enqueue.types';

@Injectable()
export class ProductPublishEnqueueService implements IProductPublishEnqueueService {
  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(LISTING_CREATION_RECORD_REPOSITORY_TOKEN)
    private readonly listingRecords: ListingCreationRecordRepositoryPort,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
  ) {}

  async enqueuePublish(input: EnqueueProductPublishInput): Promise<EnqueueProductPublishResult> {
    // 1. Resolve the adapter. getCapabilityAdapter handles the connection
    //    existence / status / capability cascade and surfaces the right
    //    exception for each failure mode. `publishProduct` is the base method
    //    of ShopProductManagerPort, so no sub-capability guard is needed.
    await this.integrationsService.getCapabilityAdapter<ShopProductManagerPort>(
      input.connectionId,
      'ProductPublisher',
    );

    // 2. Pre-create the record so the HTTP response carries an id clients can
    //    poll immediately. `bulkBatchId` is forwarded straight through so
    //    per-batch summary reads see the row before the worker terminates.
    const record = await this.listingRecords.create({
      internalVariantId: input.internalVariantId,
      connectionId: input.connectionId,
      status: LISTING_CREATION_STATUS.Pending,
      externalProductId: null,
      errors: null,
      ...(input.bulkBatchId !== undefined && { bulkBatchId: input.bulkBatchId }),
    });

    // 3. Enqueue. Bulk submissions emit V2 (carrying `bulkBatchId` +
    //    `listingCreationRecordId`) so the worker handler advances the shared
    //    batch counter on terminal status; single publishes emit V1. Each
    //    branch is `satisfies`-checked against its version interface to stay
    //    structurally assignable to the enqueue payload's Record<string, unknown>.
    const payload =
      input.bulkBatchId !== undefined
        ? ({
            schemaVersion: 2 as const,
            internalVariantId: input.internalVariantId,
            status: input.status,
            stock: input.stock,
            bulkBatchId: input.bulkBatchId,
            listingCreationRecordId: record.id,
            ...(input.price !== undefined && { price: input.price }),
            ...(input.content !== undefined && { content: input.content }),
            ...(input.idempotencyKey !== undefined && { idempotencyKey: input.idempotencyKey }),
          } satisfies ShopProductPublishPayloadV2)
        : ({
            schemaVersion: 1 as const,
            internalVariantId: input.internalVariantId,
            status: input.status,
            stock: input.stock,
            listingCreationRecordId: record.id,
            ...(input.price !== undefined && { price: input.price }),
            ...(input.content !== undefined && { content: input.content }),
            ...(input.idempotencyKey !== undefined && { idempotencyKey: input.idempotencyKey }),
          } satisfies ShopProductPublishPayloadV1);

    // Bulk default idempotency key includes the batchId so the same variant
    // re-included in a later batch isn't dropped by the job-dedup gate.
    const defaultIdempotencyKey =
      input.bulkBatchId !== undefined
        ? `bulk-publish:${input.bulkBatchId}:variant:${input.internalVariantId}`
        : `shop-publish:${record.id}`;

    const { jobId } = await this.jobEnqueue.enqueueJob({
      jobType: 'shop.product.publish',
      connectionId: input.connectionId,
      idempotencyKey: input.idempotencyKey ?? defaultIdempotencyKey,
      payload,
    });

    return { jobId, listingCreationRecord: record };
  }
}
