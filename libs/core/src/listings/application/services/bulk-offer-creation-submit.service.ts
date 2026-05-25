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
 * **Multi-variant expansion (#824):** a submitted id is a primary-variant
 * id; for a multi-variant product `submit` fans it out into one offer per
 * sibling variant (each with its own master stock from #823, self-linking
 * to its own catalog product by barcode), so Allegro auto-groups them into
 * one variant listing. `totalCount` reflects the expanded count.
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
import {
  IProductsService,
  PRODUCTS_SERVICE_TOKEN,
} from '@openlinker/core/products';
import type { ProductVariant } from '@openlinker/core/products';
import {
  IInventoryQueryService,
  INVENTORY_QUERY_SERVICE_TOKEN,
} from '@openlinker/core/inventory';

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
  ExpandedVariantJob,
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
    private readonly integrationsService: IIntegrationsService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(INVENTORY_QUERY_SERVICE_TOKEN)
    private readonly inventoryQuery: IInventoryQueryService
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

    // 2. Expand submitted primary-variant ids into the per-offer job list.
    //    A multi-variant product fans out into one job per sibling variant
    //    (#824); single-variant products and unknown ids pass through
    //    unchanged. Done before persisting the batch so `totalCount` matches
    //    the real fan-out the progress counters (#737) gate on.
    const expandedJobs = await this.expandVariantJobs(input);
    const masterStock = await this.resolveMasterStock(
      expandedJobs.filter((job) => job.useMasterStock).map((job) => job.variantId)
    );

    // 3. Persist the batch row. Status defaults to 'pending' per the
    //    `CreateBulkOfferCreationBatchInput` contract; `sharedConfig` is
    //    stored as the unstructured persistence projection of the typed
    //    `BulkSharedConfig` shape so future schema iterations don't require
    //    a migration.
    const batch = await this.bulkBatchRepository.create({
      connectionId: input.connectionId,
      initiatedBy: input.initiatedBy,
      totalCount: expandedJobs.length,
      sharedConfig: input.sharedConfig as unknown as Record<string, unknown>,
    });

    this.logger.log(
      `Bulk batch ${batch.id} persisted (connection=${input.connectionId}, ` +
        `submitted=${input.productIds.length}, totalCount=${batch.totalCount})`
    );

    // 4. Fan out enqueues. The first failing enqueue marks the batch failed
    //    and re-throws — partial-success semantics aren't useful for a fresh
    //    submission (the FE can't act on N successful + M missing jobs).
    const jobIds: string[] = [];
    try {
      for (const job of expandedJobs) {
        const enqueueInput = this.buildEnqueueInput(input, batch.id, job, masterStock);
        const { jobId } = await this.offerCreationEnqueue.enqueueCreation(enqueueInput);
        jobIds.push(jobId);
      }
    } catch (error) {
      this.logger.error(
        `Bulk batch ${batch.id} enqueue failed after ${jobIds.length}/${expandedJobs.length} jobs: ${(error as Error).message}`,
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

    // 5. All jobs on the stream — advance to 'running'. The worker handler
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
   * Expand each submitted primary-variant id into the per-offer job list
   * (#824). A multi-variant product fans out into one job per sibling
   * variant so each lists as its own Allegro offer — Allegro auto-groups
   * them into one buyer-facing listing from the Product Catalog (GTIN +
   * distinguishing parameter), so no variant-set API call is needed.
   *
   * Behaviour preserved for pre-#824 cases:
   * - an unknown id (stale selection) enqueues as a single offer;
   * - a single-variant product enqueues exactly its one variant.
   *
   * Dedup is global across the submission, so selecting two variants of the
   * same product expands that product once — the first selected id of a family
   * supplies the `perProductOverrides` entry for the whole family; a second
   * selected id of the same product is folded in without re-applying its own
   * override. Siblings without a barcode are skipped (they can't link to a
   * catalog product, so Allegro can't group them) — the originally-selected
   * id is always kept, even without a barcode.
   *
   * DB access is two parallel batches (resolve selected variants, then fetch
   * each distinct product's variants) rather than per-id sequential awaits, so
   * the operator-facing submit stays responsive for large selections.
   */
  private async expandVariantJobs(
    input: BulkOfferCreationSubmitInput
  ): Promise<ExpandedVariantJob[]> {
    const uniqueSelectedIds = [...new Set(input.productIds)];

    // Batch 1: resolve each submitted primary variant in parallel.
    const selectedVariants = await Promise.all(
      uniqueSelectedIds.map((id) => this.productsService.getVariant(id))
    );
    const selectedById = new Map<string, ProductVariant | null>(
      uniqueSelectedIds.map((id, i) => [id, selectedVariants[i]])
    );

    // Batch 2: fetch all variants for each distinct product in parallel.
    const productIds = [
      ...new Set(
        selectedVariants
          .filter((v): v is ProductVariant => v !== null)
          .map((v) => v.productId)
      ),
    ];
    const siblingLists = await Promise.all(
      productIds.map((productId) => this.productsService.getVariantsByProductId(productId))
    );
    const variantsByProduct = new Map<string, ProductVariant[]>(
      productIds.map((productId, i) => [productId, siblingLists[i]])
    );

    const jobs: ExpandedVariantJob[] = [];
    const seen = new Set<string>();

    for (const selectedId of uniqueSelectedIds) {
      if (seen.has(selectedId)) continue;

      const selectedVariant = selectedById.get(selectedId) ?? null;
      if (!selectedVariant) {
        this.logger.warn(
          `Bulk submit: variant ${selectedId} not found — enqueuing as a single offer without expansion`
        );
        jobs.push({ variantId: selectedId, selectedId, useMasterStock: false, clearProductCard: false });
        seen.add(selectedId);
        continue;
      }

      const { productId } = selectedVariant;
      const siblings = variantsByProduct.get(productId) ?? [];

      if (siblings.length <= 1) {
        jobs.push({ variantId: selectedId, selectedId, useMasterStock: false, clearProductCard: false });
        seen.add(selectedId);
        continue;
      }

      for (const sibling of siblings) {
        if (seen.has(sibling.id)) continue;
        const isSelected = sibling.id === selectedId;
        const hasBarcode = Boolean(sibling.ean ?? sibling.gtin);
        if (!hasBarcode && !isSelected) {
          this.logger.warn(
            `Bulk submit: skipping variant ${sibling.id} of product ${productId} — ` +
              `no EAN/GTIN, cannot link to an Allegro catalog product for variant grouping`
          );
          continue;
        }
        jobs.push({
          variantId: sibling.id,
          selectedId,
          useMasterStock: true,
          clearProductCard: !isSelected,
        });
        seen.add(sibling.id);
      }

      // Defensive: a multi-variant product whose `getVariantsByProductId`
      // result somehow omits the selected variant must still list it — never
      // silently drop a variant the operator explicitly picked.
      if (!seen.has(selectedId)) {
        jobs.push({ variantId: selectedId, selectedId, useMasterStock: true, clearProductCard: false });
        seen.add(selectedId);
      }
    }

    return jobs;
  }

  /**
   * Batch-resolve per-variant master availability (#823) for the given
   * variant ids into a `Map<variantId, available>`. Returns an empty map
   * for an empty input (no multi-variant expansion in the submission), so
   * the single-variant / passthrough path issues no inventory query.
   */
  private async resolveMasterStock(variantIds: string[]): Promise<Map<string, number>> {
    if (variantIds.length === 0) return new Map();
    const rows = await this.inventoryQuery.getAvailabilityByVariantIds(variantIds);
    return new Map(rows.map((row) => [row.productVariantId, row.totalAvailable]));
  }

  /**
   * Build the per-variant `EnqueueOfferCreationInput`, merging shared config
   * with the per-product override (override wins per field). Pure shape
   * transformation — no IO.
   *
   * For expanded multi-variant jobs the offered stock comes from that
   * variant's master inventory (#823/#824) and is **authoritative — including
   * 0**, so an out-of-stock variant lists as 0 rather than being backfilled
   * with the operator's bulk quantity (which would publish phantom stock and
   * risk overselling). The operator quantity remains the source for
   * single-variant / passthrough jobs, and a defensive fallback if a variant
   * is somehow absent from the availability map (it is zero-filled in
   * practice, so that fallback is effectively unreachable). Siblings also drop
   * the FE-resolved `productCardId` so each self-links to its own catalog
   * product by barcode.
   */
  private buildEnqueueInput(
    input: BulkOfferCreationSubmitInput,
    bulkBatchId: string,
    job: ExpandedVariantJob,
    masterStock: Map<string, number>
  ): EnqueueOfferCreationInput {
    const override: PerProductOverride | undefined = input.perProductOverrides?.[job.selectedId];
    const operatorStock = override?.stock ?? input.sharedConfig.stock;
    const masterAvailable = job.useMasterStock ? masterStock.get(job.variantId) : undefined;
    const stock = masterAvailable ?? operatorStock;
    const publishImmediately =
      override?.publishImmediately ?? input.sharedConfig.publishImmediately;
    const price = override?.price ?? input.sharedConfig.price;
    // Layer per-product overrides on top of the batch-wide shared overrides.
    // A wholesale `??` replacement silently dropped shared settings the wizard
    // never repeats per row — notably `platformParams.deliveryPolicyId`, whose
    // absence makes Allegro reject the offer with
    // `DefaultShippingRatesNotFoundException`. (#808)
    let overrides = this.mergeOverrides(input.sharedConfig.overrides, override?.overrides);
    if (job.clearProductCard && overrides?.productCardId !== undefined) {
      const withoutCard: CreateOfferOverrides = { ...overrides };
      delete withoutCard.productCardId;
      overrides = Object.keys(withoutCard).length > 0 ? withoutCard : undefined;
    }

    return {
      internalVariantId: job.variantId,
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
