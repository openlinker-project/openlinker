/**
 * Bulk Offer Creation Submit Service (#736)
 *
 * Composes the just-shipped `BulkOfferCreationBatch` aggregate (#734) into
 * an operator-facing bulk-listing flow: validates connection + adapter
 * capability up front, persists the parent batch row, fans N enqueues out
 * through the existing `IOfferCreationEnqueueService` (so the per-record
 * persistence + idempotency-key generation stays single-sourced — see
 * Plan §5 "Reuse decision"), advances the batch to `'running'` once all
 * jobs are on the stream, and exposes a `getBatch` read for the wizard's
 * progress page in #741.
 *
 * Terminal-status derivation (`completed | partially-failed | failed`
 * once `succeededCount + failedCount === totalCount`) is documented as
 * owned by this service per `architecture-overview.md` §7. The
 * state-machine method is added by the worker handler change in **#737** —
 * this slice intentionally exposes only `submit` + `getBatch`.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IBulkOfferCreationSubmitService}
 * @see {@link IBulkOfferCreationSubmitService} for the service contract
 * @see {@link IOfferCreationEnqueueService} for the per-product enqueue half
 */

import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';

import {
  BULK_BATCH_STATUS,
  isOfferCreator,
  OFFER_CREATION_ENQUEUE_SERVICE_TOKEN,

  BulkOfferCreationBatchRepositoryPort,
  IOfferCreationEnqueueService,
  OfferCreationRecordRepositoryPort} from '@openlinker/core/listings';
import type {
  CreateOfferOverrides,
  OfferManagerPort,
} from '@openlinker/core/listings';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';

import { EmptyBulkSubmissionException } from '../../domain/exceptions/empty-bulk-submission.exception';
import {
  BULK_OFFER_CREATION_BATCH_REPOSITORY_TOKEN,
  OFFER_CREATION_RECORD_REPOSITORY_TOKEN,
} from '../../listings.tokens';
import type { IBulkOfferCreationSubmitService } from '../interfaces/bulk-offer-creation-submit.service.interface';
import type {
  BulkBatchSummary,
  BulkOfferCreationSubmitInput,
  BulkOfferCreationSubmitResult,
  PerProductOverride,
} from '../types/bulk-offer-creation-submit.types';
import type { EnqueueOfferCreationInput } from '../types/offer-creation-enqueue.types';

@Injectable()
export class BulkOfferCreationSubmitService implements IBulkOfferCreationSubmitService {
  private readonly logger = new Logger(BulkOfferCreationSubmitService.name);

  constructor(
    @Inject(BULK_OFFER_CREATION_BATCH_REPOSITORY_TOKEN)
    private readonly bulkBatchRepository: BulkOfferCreationBatchRepositoryPort,
    @Inject(OFFER_CREATION_RECORD_REPOSITORY_TOKEN)
    private readonly offerCreationRecords: OfferCreationRecordRepositoryPort,
    @Inject(OFFER_CREATION_ENQUEUE_SERVICE_TOKEN)
    private readonly offerCreationEnqueue: IOfferCreationEnqueueService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService
  ) {}

  async submit(input: BulkOfferCreationSubmitInput): Promise<BulkOfferCreationSubmitResult> {
    if (input.productIds.length === 0) {
      throw new EmptyBulkSubmissionException();
    }

    // 1. Resolve adapter + assert OfferCreator BEFORE persisting the batch.
    //    Doing the capability check first means a wrong-capability submit
    //    never leaves an orphan `'failed'` batch with 0 children (which
    //    `BulkBatchStatus` doesn't model — `'failed'` is documented as
    //    "all children failed"). The same check repeats inside
    //    `OfferCreationEnqueueService.enqueueCreation` per product — the
    //    duplication is intentional: the bulk service guarantees no batch
    //    row exists for an impossible submission, while the enqueue
    //    service stays usable on its own from the single-offer endpoint.
    //
    //    `getCapabilityAdapter` surfaces the connection-failure cascade
    //    (`ConnectionNotFoundException`, `ConnectionDisabledException`,
    //    `CapabilityNotSupportedException`) — they propagate unchanged so
    //    the controller / Nest filters map them to HTTP codes consistently
    //    with the single-offer path.
    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      input.connectionId,
      'OfferManager'
    );
    if (!isOfferCreator(adapter)) {
      throw new UnprocessableEntityException(
        `Adapter for connection ${input.connectionId} does not support offer creation`
      );
    }

    // 2. Persist the batch row. Status defaults to 'pending' per the
    //    `CreateBulkOfferCreationBatchInput` contract; `sharedConfig` is
    //    stored as the unstructured persistence projection of the typed
    //    `BulkSharedConfig` shape so future schema iterations don't require
    //    a migration.
    const batch = await this.bulkBatchRepository.create({
      connectionId: input.connectionId,
      initiatedBy: input.initiatedBy,
      totalCount: input.productIds.length,
      sharedConfig: input.sharedConfig as unknown as Record<string, unknown>,
    });

    this.logger.log(
      `Bulk batch ${batch.id} persisted (connection=${input.connectionId}, totalCount=${batch.totalCount})`
    );

    // 3. Fan out enqueues. The first failing enqueue marks the batch failed
    //    and re-throws — partial-success semantics aren't useful for a fresh
    //    submission (the FE can't act on N successful + M missing jobs).
    const jobIds: string[] = [];
    try {
      for (const productId of input.productIds) {
        const enqueueInput = this.buildEnqueueInput(input, batch.id, productId);
        const { jobId } = await this.offerCreationEnqueue.enqueueCreation(enqueueInput);
        jobIds.push(jobId);
      }
    } catch (error) {
      this.logger.error(
        `Bulk batch ${batch.id} enqueue failed after ${jobIds.length}/${input.productIds.length} jobs: ${(error as Error).message}`,
        (error as Error).stack
      );
      // Best-effort terminal-status flip; if this also fails the underlying
      // enqueue error still propagates and dominates the FE message.
      try {
        await this.bulkBatchRepository.updateStatus(batch.id, BULK_BATCH_STATUS.Failed);
      } catch (statusError) {
        this.logger.error(
          `Bulk batch ${batch.id} status flip to 'failed' also failed: ${(statusError as Error).message}`,
          (statusError as Error).stack
        );
      }
      throw error;
    }

    // 4. All jobs on the stream — advance to 'running'. The worker handler
    //    (#737) will derive the terminal status from per-job counters via
    //    `incrementCounters`.
    await this.bulkBatchRepository.updateStatus(batch.id, BULK_BATCH_STATUS.Running);

    return { batchId: batch.id, jobIds };
  }

  async getBatch(batchId: string): Promise<BulkBatchSummary | null> {
    const batch = await this.bulkBatchRepository.findById(batchId);
    if (!batch) {
      return null;
    }
    const records = await this.offerCreationRecords.findByBulkBatchId(batchId);
    return { batch, records };
  }

  /**
   * Build the per-product `EnqueueOfferCreationInput`, merging shared
   * config with the matching per-product override (override wins per
   * field). Pure shape transformation — no IO.
   */
  private buildEnqueueInput(
    input: BulkOfferCreationSubmitInput,
    bulkBatchId: string,
    productId: string
  ): EnqueueOfferCreationInput {
    const override: PerProductOverride | undefined = input.perProductOverrides?.[productId];
    const stock = override?.stock ?? input.sharedConfig.stock;
    const publishImmediately =
      override?.publishImmediately ?? input.sharedConfig.publishImmediately;
    const price = override?.price ?? input.sharedConfig.price;
    // Layer per-product overrides on top of the batch-wide shared overrides.
    // A wholesale `??` replacement silently dropped shared settings the wizard
    // never repeats per row — notably `platformParams.deliveryPolicyId`, whose
    // absence makes Allegro reject the offer with
    // `DefaultShippingRatesNotFoundException`. (#808)
    const overrides = this.mergeOverrides(input.sharedConfig.overrides, override?.overrides);

    return {
      internalVariantId: productId,
      connectionId: input.connectionId,
      stock,
      publishImmediately,
      bulkBatchId,
      generateDescription: input.sharedConfig.generateDescription ?? false,
      ...(price !== undefined && { price }),
      ...(overrides !== undefined && { overrides }),
      ...(input.sharedConfig.descriptionTone !== undefined && {
        descriptionTone: input.sharedConfig.descriptionTone,
      }),
    };
  }

  /**
   * Layer a per-product override on top of the batch-wide shared overrides.
   * Scalar fields (title, categoryId, productCardId, imageUrls, …) take the
   * per-product value when present; `platformParams` is **deep-merged** so
   * shared keys (e.g. `deliveryPolicyId`) survive even when a row supplies its
   * own platform tweaks. Returns `undefined` only when neither side has any
   * overrides, so the enqueue input keeps omitting the field in that case.
   */
  private mergeOverrides(
    shared: CreateOfferOverrides | undefined,
    perProduct: CreateOfferOverrides | undefined
  ): CreateOfferOverrides | undefined {
    if (!shared && !perProduct) return undefined;
    const merged: CreateOfferOverrides = { ...shared, ...perProduct };
    if (shared?.platformParams || perProduct?.platformParams) {
      merged.platformParams = {
        ...shared?.platformParams,
        ...perProduct?.platformParams,
      };
    }
    return merged;
  }
}

/*
 * Worker-handler seam: shipped as `BulkOfferCreationProgressService.advanceBatchStatus`
 * in #737. The terminal-state derivation rule lives there. See
 * `bulk-offer-creation-progress.service.ts`.
 */
