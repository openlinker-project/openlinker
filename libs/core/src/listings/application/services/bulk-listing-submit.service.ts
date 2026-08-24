/**
 * Bulk Offer Creation Submit Service (#736)
 *
 * Composes the just-shipped `BulkListingBatch` aggregate (#734) into
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
 * @implements {IBulkListingSubmitService}
 * @see {@link IBulkListingSubmitService} for the service contract
 * @see {@link IOfferCreationEnqueueService} for the per-product enqueue half
 */

import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';

import {
  BULK_BATCH_STATUS,
  isOfferCreator,
  isCatalogProductReader,
  OFFER_CREATION_ENQUEUE_SERVICE_TOKEN,
  OFFER_MAPPING_REPOSITORY_TOKEN,

  BulkListingBatchRepositoryPort,
  IOfferCreationEnqueueService,
  OfferCreationRecordRepositoryPort,
  OfferMappingRepositoryPort} from '@openlinker/core/listings';
import type {
  BulkBatchStatus,
  BulkListingBatch,
  CreateOfferOverrides,
  OfferCreationRecord,
  OfferManagerPort,
} from '@openlinker/core/listings';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
  resolveVariantGroupingModel,
} from '@openlinker/core/integrations';
import type { VariantGroupingModel } from '@openlinker/core/integrations';
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
import { AllVariantsAlreadyListedException } from '../../domain/exceptions/all-variants-already-listed.exception';
import { InvalidEanException } from '../../domain/exceptions/invalid-ean.exception';
import { DuplicateBatchEanException } from '../../domain/exceptions/duplicate-batch-ean.exception';
import { CurrencyMismatchException } from '../../domain/exceptions/currency-mismatch.exception';
import { InvalidOverrideKeyException } from '../../domain/exceptions/invalid-override-key.exception';
import { ExpandedOfferCeilingExceededException } from '../../domain/exceptions/expanded-offer-ceiling-exceeded.exception';
import { AvailabilityUnknownError } from '../../domain/exceptions/availability-unknown.error';
import {
  BULK_LISTING_BATCH_REPOSITORY_TOKEN,
  OFFER_CREATION_RECORD_REPOSITORY_TOKEN,
} from '../../listings.tokens';
import type { IBulkListingSubmitService } from '../interfaces/bulk-listing-submit.service.interface';
import type {
  BulkBatchSummary,
  BulkListingSubmitInput,
  BulkListingSubmitResult,
  ExpandedVariantJob,
  PerProductOverride,
} from '../types/bulk-listing-submit.types';
import type { EnqueueOfferCreationInput } from '../types/offer-creation-enqueue.types';

/**
 * Hard ceiling on the post-exclusion expanded offer count (#1741). The
 * submitted-product cap is 100 (DTO), but per-variant fan-out multiplies that,
 * so guard the total offers a single batch can create.
 */
const EXPANDED_OFFER_CEILING = 1000;

/**
 * Internal-variant-id shape used to gate override-map keys (#1741). Rejecting
 * anything else is a prototype-pollution guard (`__proto__`, `constructor`)
 * and closes off keys that can never resolve to a real variant.
 */
const INTERNAL_VARIANT_ID_RE = /^ol_variant_[a-f0-9]+$/;

/** GTIN lengths that carry a trailing GS1 mod-10 check digit (EAN-8/13, UPC-A, GTIN-14). */
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

@Injectable()
export class BulkListingSubmitService implements IBulkListingSubmitService {
  private readonly logger = new Logger(BulkListingSubmitService.name);

  constructor(
    @Inject(BULK_LISTING_BATCH_REPOSITORY_TOKEN)
    private readonly bulkBatchRepository: BulkListingBatchRepositoryPort,
    @Inject(OFFER_CREATION_RECORD_REPOSITORY_TOKEN)
    private readonly offerCreationRecords: OfferCreationRecordRepositoryPort,
    @Inject(OFFER_MAPPING_REPOSITORY_TOKEN)
    private readonly offerMappings: OfferMappingRepositoryPort,
    @Inject(OFFER_CREATION_ENQUEUE_SERVICE_TOKEN)
    private readonly offerCreationEnqueue: IOfferCreationEnqueueService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(INVENTORY_QUERY_SERVICE_TOKEN)
    private readonly inventoryQuery: IInventoryQueryService
  ) {}

  async submit(input: BulkListingSubmitInput): Promise<BulkListingSubmitResult> {
    if (input.productIds.length === 0) {
      throw new EmptyBulkSubmissionException();
    }

    // 0. Validate the override-map key shapes + per-row currency and strip any
    //    per-variant categoryId (#1741). Runs first (before any IO) so a
    //    prototype-pollution key or a divergent currency fails fast, and the
    //    downstream `Record<>` lookups only ever see well-formed keys.
    this.validateOverrideMaps(input);

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

    // Grouping strategy is capability-driven, never platform-named (#1741
    // review #2). A catalog auto-grouper (Allegro — `CatalogProductReader`)
    // groups siblings by linking each to a catalog product via its barcode, so
    // a barcode-less sibling cannot be grouped and is dropped. A destination
    // that groups explicitly (Erli — `externalVariantGroup` + `attributes`,
    // #986/#1065) needs no per-variant barcode, so its barcode-less siblings
    // must NOT be dropped. Keeping this neutral prevents Allegro's grouping
    // strategy leaking into the platform-agnostic submit service.
    const dropBarcodelessSiblings = isCatalogProductReader(adapter);

    // Variant-grouping model (#1924): declared on the manifest, read directly
    // off the metadata `getAdapter` already resolves — not a capability, so
    // never dispatched through `getCapabilityAdapter`. Drives whether a
    // per-variant categoryId survives to the built offer (buildEnqueueInput →
    // stripVariantCategoryId below).
    const { metadata } = await this.integrationsService.getAdapter(input.connectionId);
    const variantGroupingModel = resolveVariantGroupingModel(metadata);

    // 2. Expand submitted primary-variant ids into the per-offer job list.
    //    A multi-variant product fans out into one job per sibling variant
    //    (#824); single-variant products and unknown ids pass through
    //    unchanged. Done before persisting the batch so `totalCount` matches
    //    the real fan-out the progress counters (#737) gate on.
    const { jobs: expandedJobs, variantsById } = await this.expandVariantJobs(
      input,
      dropBarcodelessSiblings
    );

    // Skip variants that already carry an active offer mapping on this
    // connection (#1741 review #3). Re-running the wizard for a product without
    // excluding already-listed siblings would otherwise create duplicate
    // marketplace offers (batch-scoped idempotency keys don't dedup across
    // batches, and Allegro doesn't enforce uniqueness on product-offer
    // `external.id`) and fragment the grouped listing. The FE `alreadyListed`
    // hint is advisory only; this is the authoritative backend guard.
    const listableJobs = await this.filterAlreadyListed(input.connectionId, expandedJobs);
    const skippedAlreadyListedCount = expandedJobs.length - listableJobs.length;

    // Post-exclusion empty guard (#1741). Two distinct causes, #1933: if the
    // expansion itself produced no jobs (every submitted id was excluded /
    // unresolvable), the submission was genuinely empty. If expansion DID
    // produce jobs but every one was then dropped as already-listed, that is
    // NOT an empty submission — the operator selected real variants that are
    // all duplicates of what's already published — and must be reported as
    // such rather than reusing the generic "requires at least one productId"
    // message, which the #1837 duplicate-guard confirm flow renders after an
    // explicit "Publish anyway (creates duplicate)" click.
    if (listableJobs.length === 0) {
      if (expandedJobs.length > 0) {
        throw new AllVariantsAlreadyListedException(skippedAlreadyListedCount);
      }
      throw new EmptyBulkSubmissionException();
    }
    // Identifier enforcement (#1741): GS1 check-digit on every included job's
    // effective EAN + batch-wide effective-identifier uniqueness. Done before
    // persisting so a bad/duplicate barcode never creates a batch row (the
    // #742 retry rebuilds from the snapshot and does NOT re-validate).
    this.enforceIdentifierRules(input, listableJobs, variantsById);
    const masterStock = await this.resolveMasterStock(
      listableJobs.filter((job) => job.useMasterStock).map((job) => job.variantId)
    );

    // #2323 — a master-stock job whose availability came back UNKNOWN is
    // EXCLUDED from the batch. `resolveMasterStock` zero-fills every id it
    // could answer for, so an absent entry means "OL does not know", never
    // "no stock": listing it would either publish a guessed number or (via the
    // old `?? 0`) create a permanently-draft 0-stock offer the operator never
    // asked for. Excluding is the only answer that asserts nothing false.
    const unknownAvailability = listableJobs.filter(
      (job) => job.useMasterStock && !masterStock.has(job.variantId)
    );
    const jobs =
      unknownAvailability.length === 0
        ? listableJobs
        : listableJobs.filter((job) => !job.useMasterStock || masterStock.has(job.variantId));
    if (unknownAvailability.length > 0) {
      this.logger.warn(
        `bulk_listing_variant_excluded_availability_unknown connection=${input.connectionId} ` +
          `excluded=${unknownAvailability.length} of=${listableJobs.length} — availability could ` +
          `not be resolved for these variants; they were left out of the batch rather than ` +
          `published at a guessed quantity`
      );
      // Every job excluded means the whole read failed, which is transient.
      // Reporting an empty submission would blame the operator's selection for
      // an infrastructure outage and invite them to re-pick the same variants.
      if (jobs.length === 0) {
        throw new AvailabilityUnknownError(input.connectionId, unknownAvailability[0].variantId);
      }
    }

    // 3. Persist the batch row. Status defaults to 'pending' per the
    //    `CreateBulkListingBatchInput` contract; `sharedConfig` is
    //    stored as the unstructured persistence projection of the typed
    //    `BulkSharedConfig` shape so future schema iterations don't require
    //    a migration.
    const batch = await this.bulkBatchRepository.create({
      connectionId: input.connectionId,
      initiatedBy: input.initiatedBy,
      totalCount: jobs.length,
      sharedConfig: input.sharedConfig as unknown as Record<string, unknown>,
    });

    this.logger.log(
      `Bulk batch ${batch.id} persisted (connection=${input.connectionId}, ` +
        `submitted=${input.productIds.length}, totalCount=${batch.totalCount})`
    );

    // 4. Fan out enqueues. On a mid-fan-out failure the batch is reconciled so
    //    it can still reach a terminal status (#1741 partial-submit atomicity):
    //    - if ≥1 job already reached the stream, reconcile `totalCount` down to
    //      the number actually enqueued, delete any orphaned pre-created record
    //      (the variant whose enqueue threw after `enqueueCreation` persisted its
    //      record but before the stream write, #1741 review #6), and advance to
    //      'running' - the enqueued children run normally and the #737 counter
    //      gate (`succeeded + failed === totalCount`) terminates the batch.
    //      Without the delete, `findByBulkBatchId` would surface a phantom
    //      pending child forever.
    //    - if nothing enqueued, flip terminal 'failed' (no children to count).
    //    The underlying enqueue error is still re-thrown so the operator learns
    //    the submit was partial.
    const jobIds: string[] = [];
    const enqueuedRecordIds = new Set<string>();
    try {
      for (const job of jobs) {
        const enqueueInput = this.buildEnqueueInput(
          input,
          batch.id,
          job,
          masterStock,
          variantGroupingModel
        );
        const { jobId, offerCreationRecord } =
          await this.offerCreationEnqueue.enqueueCreation(enqueueInput);
        jobIds.push(jobId);
        enqueuedRecordIds.add(offerCreationRecord.id);
      }
    } catch (error) {
      const enqueued = jobIds.length;
      this.logger.error(
        `Bulk batch ${batch.id} enqueue failed after ${enqueued}/${jobs.length} jobs: ${(error as Error).message}`,
        (error as Error).stack
      );
      // Best-effort reconciliation; if it also fails the underlying enqueue
      // error still propagates and dominates the FE message.
      try {
        await this.deleteOrphanRecords(batch.id, enqueuedRecordIds);
        if (enqueued > 0) {
          // Reconcile `totalCount` down to what actually reached the stream,
          // then perform a LEVEL-triggered terminal check (#1741 review #1).
          // The #737 counter gate is edge-triggered — it only fires when a
          // child terminates. If every enqueued child already terminated
          // before this reconcile ran, no callback ever re-evaluates the gate
          // against the new `totalCount`, and a blind flip to 'running' would
          // strand the batch there forever (no sweep reconciles stuck
          // 'running' batches; retry only reopens terminal ones). Re-reading
          // the counters here and deriving the terminal status when
          // `succeeded + failed === totalCount` closes that race regardless of
          // completion timing (`updateTotalCount` returns the post-update row
          // with a fresh counter read; `updateStatus` is idempotent, so a
          // child that terminates concurrently and also derives the terminal
          // status is harmless).
          const reconciled = await this.bulkBatchRepository.updateTotalCount(batch.id, enqueued);
          const nextStatus = isBatchFinished(reconciled)
            ? deriveTerminalStatus(reconciled)
            : BULK_BATCH_STATUS.Running;
          await this.bulkBatchRepository.updateStatus(batch.id, nextStatus);
        } else {
          await this.bulkBatchRepository.updateStatus(batch.id, BULK_BATCH_STATUS.Failed);
        }
      } catch (reconcileError) {
        this.logger.error(
          `Bulk batch ${batch.id} partial-submit reconciliation also failed: ${(reconcileError as Error).message}`,
          (reconcileError as Error).stack
        );
      }
      throw error;
    }

    // 5. All jobs on the stream — advance to 'running'. The worker handler
    //    (#737) will derive the terminal status from per-job counters via
    //    `incrementCounters`.
    await this.bulkBatchRepository.updateStatus(batch.id, BULK_BATCH_STATUS.Running);

    return { batchId: batch.id, jobIds, skippedAlreadyListedCount };
  }

  async getBatch(batchId: string): Promise<BulkBatchSummary | null> {
    const batch = await this.bulkBatchRepository.findById(batchId);
    if (!batch) {
      return null;
    }
    const records = await this.offerCreationRecords.findByBulkBatchId(batchId);
    return {
      batch,
      records,
      productIdByVariantId: await this.resolveProductIds(records),
    };
  }

  /**
   * Map each record's variant id to its owning product id (#2234). The FE
   * needs product ids to reopen the bulk wizard on a failed batch's variants,
   * and neither `OfferCreationRecord` nor its request snapshot carries one.
   * One batched lookup per page load; a variant that no longer resolves is
   * omitted rather than defaulted, so the caller can tell "no product link"
   * apart from a wrong one.
   */
  private async resolveProductIds(
    records: readonly OfferCreationRecord[]
  ): Promise<Record<string, string>> {
    const variantIds = [...new Set(records.map((record) => record.internalVariantId))];
    if (variantIds.length === 0) return {};

    const variants = await this.productsService.getVariantsByIds(variantIds);
    const productIdByVariantId: Record<string, string> = {};
    for (const variant of variants) {
      productIdByVariantId[variant.id] = variant.productId;
    }
    return productIdByVariantId;
  }

  /**
   * Drop jobs whose variant already carries a LIVE offer mapping on the target
   * connection (#1741 review #3). "Live" is now enforced rather than merely
   * asserted: `countByConnectionAndVariants` excludes mappings whose status
   * snapshot says `ended`, so a variant whose offer is over can be listed again
   * (#1934/F2). Previously the query had no status predicate at all despite
   * this docstring, which made an ended offer block its variant permanently.
   *
   * One batched count query rather than
   * a per-variant fan-out; a variant with `count > 0` is skipped with a warning
   * so a re-run of the wizard can't silently create duplicate offers.
   */
  private async filterAlreadyListed(
    connectionId: string,
    jobs: ExpandedVariantJob[]
  ): Promise<ExpandedVariantJob[]> {
    if (jobs.length === 0) return jobs;
    const counts = await this.offerMappings.countByConnectionAndVariants(
      connectionId,
      jobs.map((job) => job.variantId)
    );
    return jobs.filter((job) => {
      if ((counts.get(job.variantId) ?? 0) > 0) {
        this.logger.warn(
          `Bulk submit: skipping variant ${job.variantId} — already has an active offer ` +
            `mapping on connection ${connectionId} (re-listing would create a duplicate offer)`
        );
        return false;
      }
      return true;
    });
  }

  /**
   * Delete pre-created records for the batch that never reached the stream
   * (#1741 review #6). `enqueueCreation` persists the record before enqueuing,
   * so a stream write that throws leaves an orphaned pending record with no job
   * — deleting it keeps the persisted-record set aligned with the reconciled
   * `totalCount`. Best-effort; each delete is idempotent.
   */
  private async deleteOrphanRecords(
    batchId: string,
    enqueuedRecordIds: ReadonlySet<string>
  ): Promise<void> {
    const records = await this.offerCreationRecords.findByBulkBatchId(batchId);
    for (const record of records) {
      if (!enqueuedRecordIds.has(record.id)) {
        await this.offerCreationRecords.deleteById(record.id);
      }
    }
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
   *
   * `dropBarcodelessSiblings` is capability-driven (#1741 review #2): true only
   * when the destination groups via a catalog product keyed by barcode (Allegro
   * `CatalogProductReader`). An explicit-grouping destination (Erli) passes
   * false so its barcode-less siblings are kept rather than silently skipped.
   */
  private async expandVariantJobs(
    input: BulkListingSubmitInput,
    dropBarcodelessSiblings: boolean
  ): Promise<{ jobs: ExpandedVariantJob[]; variantsById: Map<string, ProductVariant | null> }> {
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
    // #1741: the resolved variant entity behind each job, so the caller's
    // identifier enforcement can read `variant.ean ?? variant.gtin` without a
    // second fetch. `null` for an unknown (stale-selection) passthrough job.
    const variantsById = new Map<string, ProductVariant | null>();
    const seen = new Set<string>();
    // #1741: variants the operator switched off - never enqueue these, and
    // never resurrect an excluded seed via the defensive re-add below.
    const excluded = new Set(input.excludedVariantIds ?? []);
    // #1741: an operator-overridden EAN (per-variant) rescues a barcode-less
    // sibling so it is no longer silently dropped by the barcode gate.
    const overrideEan = (variantId: string): string | undefined =>
      input.perVariantOverrides?.[variantId]?.overrides?.ean;

    // #1689 review #7: a variant deleted at its master (`isStale`) must never
    // become a new offer — the new-offer path fails safe here, mirroring the
    // live-offer pause. Applied at every job-push site below, including the
    // directly-selected variant — a stale explicit selection is skipped too,
    // not silently listed.
    const shouldSkipStale = (variant: ProductVariant): boolean => variant.isStale === true;

    for (const selectedId of uniqueSelectedIds) {
      if (seen.has(selectedId)) continue;

      const selectedVariant = selectedById.get(selectedId) ?? null;
      if (!selectedVariant) {
        seen.add(selectedId);
        if (excluded.has(selectedId)) continue;
        this.logger.warn(
          `Bulk submit: variant ${selectedId} not found — enqueuing as a single offer without expansion`
        );
        jobs.push({ variantId: selectedId, selectedId, useMasterStock: false, clearProductCard: false });
        variantsById.set(selectedId, null);
        continue;
      }

      const { productId } = selectedVariant;
      const siblings = variantsByProduct.get(productId) ?? [];

      if (siblings.length <= 1) {
        seen.add(selectedId);
        if (excluded.has(selectedId)) continue;
        if (shouldSkipStale(selectedVariant)) {
          this.logger.warn(
            `Bulk submit: skipping variant ${selectedId} of product ${productId} — deleted at the master (isStale)`
          );
          continue;
        }
        jobs.push({ variantId: selectedId, selectedId, useMasterStock: false, clearProductCard: false });
        variantsById.set(selectedId, selectedVariant);
        continue;
      }

      for (const sibling of siblings) {
        if (seen.has(sibling.id)) continue;
        seen.add(sibling.id);
        if (excluded.has(sibling.id)) continue;
        const isSelected = sibling.id === selectedId;
        if (shouldSkipStale(sibling)) {
          this.logger.warn(
            `Bulk submit: skipping variant ${sibling.id} of product ${productId} — deleted at the master (isStale)`
          );
          continue;
        }
        const hasBarcode = Boolean(sibling.ean ?? sibling.gtin ?? overrideEan(sibling.id));
        if (!hasBarcode && !isSelected && dropBarcodelessSiblings) {
          this.logger.warn(
            `Bulk submit: skipping variant ${sibling.id} of product ${productId} — ` +
              `no EAN/GTIN and no override, cannot link to a catalog product for variant grouping`
          );
          continue;
        }
        jobs.push({
          variantId: sibling.id,
          selectedId,
          useMasterStock: true,
          clearProductCard: !isSelected,
        });
        variantsById.set(sibling.id, sibling);
      }

      // Defensive: a multi-variant product whose `getVariantsByProductId`
      // result somehow omits the selected variant must still list it — never
      // silently drop a variant the operator explicitly picked, UNLESS it was
      // explicitly excluded (#1741) or stale (#1689).
      if (!seen.has(selectedId) && !excluded.has(selectedId) && !shouldSkipStale(selectedVariant)) {
        jobs.push({ variantId: selectedId, selectedId, useMasterStock: true, clearProductCard: false });
        variantsById.set(selectedId, selectedVariant);
        seen.add(selectedId);
      }
    }

    if (jobs.length > EXPANDED_OFFER_CEILING) {
      throw new ExpandedOfferCeilingExceededException(jobs.length, EXPANDED_OFFER_CEILING);
    }

    return { jobs, variantsById };
  }

  /**
   * Validate override-map key shapes + per-row currency, and strip any
   * per-variant `categoryId`, before expansion / persistence (#1741).
   *
   * - **Key shape**: every key of `perProductOverrides` / `perVariantOverrides`
   *   and every `excludedVariantIds` entry must match the internal-variant-id
   *   shape (`ol_variant_{hex}`); anything else (`__proto__`, `constructor`,
   *   arbitrary strings) throws `InvalidOverrideKeyException` - a
   *   prototype-pollution guard.
   * - **Currency**: an override `price.currency` diverging from the batch
   *   `sharedConfig.price.currency` throws `CurrencyMismatchException`
   *   (currency is batch-wide).
   *
   * A per-variant `categoryId` is not mutated away here — the DTO accepts it at
   * both tiers (#1924), and `buildEnqueueInput` conditionally strips it
   * non-destructively from the variant tier before merging (destination-aware,
   * via `stripVariantCategoryId`), so this validator leaves its input untouched
   * (#1741 review — no input mutation).
   *
   * Iterates with `Object.keys` (own enumerable keys only) so a JSON
   * `__proto__` own-property key is enumerated + rejected and the prototype
   * chain is never walked.
   */
  private validateOverrideMaps(input: BulkListingSubmitInput): void {
    const batchCurrency = input.sharedConfig.price?.currency;
    this.assertOverrideMap('perProductOverrides', input.perProductOverrides, batchCurrency);
    this.assertOverrideMap('perVariantOverrides', input.perVariantOverrides, batchCurrency);
    for (const id of input.excludedVariantIds ?? []) {
      if (!INTERNAL_VARIANT_ID_RE.test(id)) {
        throw new InvalidOverrideKeyException('excludedVariantIds', id);
      }
    }
  }

  private assertOverrideMap(
    field: 'perProductOverrides' | 'perVariantOverrides',
    map: Record<string, PerProductOverride> | undefined,
    batchCurrency: string | undefined
  ): void {
    if (!map) return;
    for (const key of Object.keys(map)) {
      if (!INTERNAL_VARIANT_ID_RE.test(key)) {
        throw new InvalidOverrideKeyException(field, key);
      }
      const value = map[key];
      const overrideCurrency = value?.price?.currency;
      if (
        batchCurrency !== undefined &&
        overrideCurrency !== undefined &&
        overrideCurrency !== batchCurrency
      ) {
        throw new CurrencyMismatchException(key, overrideCurrency, batchCurrency);
      }
    }
  }

  /**
   * Enforce identifier integrity on the included fan-out (#1741). For each job
   * the effective EAN is
   * `perVariantOverrides[variantId].overrides.ean ?? variant.ean ?? variant.gtin`
   * - the same value the offer builder self-links / category-resolves by:
   *
   * - a present GTIN-length EAN (8/12/13/14) with an invalid GS1 check digit
   *   throws `InvalidEanException`. Operator-entered override EANs are already
   *   constrained to a valid GTIN length by the request DTO
   *   (`^(\d{8}|\d{12,14})$`, #1741 review #4); master-sourced codes of an
   *   off-GTIN length are tolerated here rather than failing the whole batch on
   *   one dirty catalogue row (the checksum gate simply skips them);
   * - two included variants (of the same or different products) resolving to the
   *   same GTIN identity throw `DuplicateBatchEanException` - they would
   *   otherwise collapse onto one catalog card and lose their variant grouping.
   *   Uniqueness compares the GTIN-14-normalised form (left zero-padded), so
   *   `5901234123457` and `05901234123457` — the same GS1 identity — collide as
   *   intended (#1741 review suggestion).
   *
   * Null / barcode-less variants are skipped (a barcode-less sibling lists
   * standalone). Runs before persistence because #742 retry rebuilds from the
   * persisted snapshot and does not re-validate.
   */
  private enforceIdentifierRules(
    input: BulkListingSubmitInput,
    jobs: ExpandedVariantJob[],
    variantsById: Map<string, ProductVariant | null>
  ): void {
    const firstSeenByGtin = new Map<string, string>();
    for (const job of jobs) {
      const variant = variantsById.get(job.variantId) ?? null;
      const ean =
        input.perVariantOverrides?.[job.variantId]?.overrides?.ean ??
        variant?.ean ??
        variant?.gtin ??
        null;
      if (ean == null) continue;

      const isGtinLength = GTIN_LENGTHS.has(ean.length);
      if (isGtinLength && !isValidGs1CheckDigit(ean)) {
        throw new InvalidEanException(job.variantId, ean);
      }

      // Normalise to GTIN-14 for the identity comparison so zero-padding variants
      // collapse to one identity; off-GTIN-length codes compare verbatim.
      const gtinKey = isGtinLength ? ean.padStart(14, '0') : ean;
      const firstVariantId = firstSeenByGtin.get(gtinKey);
      if (firstVariantId !== undefined && firstVariantId !== job.variantId) {
        throw new DuplicateBatchEanException(ean, [firstVariantId, job.variantId]);
      }
      firstSeenByGtin.set(gtinKey, job.variantId);
    }
  }

  /**
   * Batch-resolve per-variant master availability (#823) for the given
   * variant ids into a `Map<variantId, available>`. Returns an empty map
   * for an empty input (no multi-variant expansion in the submission), so
   * the single-variant / passthrough path issues no inventory query.
   *
   * Reads `availableToPromise` (#2323) rather than `totalAvailable`: this is a
   * PUBLISHING path, so the quantity it resolves becomes a live marketplace
   * offer, and it must be net of OL's own outstanding holds. On a Wave-1b
   * install (empty ledger) the two are the same number, so nothing published
   * changes today.
   *
   * A variant whose availability is UNKNOWN is left OUT of the map — never
   * backfilled from `totalAvailable`, which would publish the un-reserved
   * quantity and oversell by exactly the outstanding holds. The caller excludes
   * such variants from the batch rather than listing them at a guessed number.
   */
  private async resolveMasterStock(variantIds: string[]): Promise<Map<string, number>> {
    if (variantIds.length === 0) return new Map();
    const rows = await this.inventoryQuery.getAvailabilityByVariantIds(variantIds);
    return new Map(
      rows
        .filter((row): row is typeof row & { availableToPromise: number } =>
          row.availableToPromise !== null
        )
        .map((row) => [row.productVariantId, row.availableToPromise])
    );
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
   * single-variant / passthrough jobs. A sibling absent from the availability
   * map resolves to 0 (out-of-stock) - the `?? 0` case is reachable and
   * intentional (no phantom stock, #1741): a variant with no master row lists
   * as 0 rather than being backfilled with the operator's bulk quantity.
   * Siblings also drop the FE-resolved `productCardId` so each self-links to
   * its own catalog product by barcode.
   */
  private buildEnqueueInput(
    input: BulkListingSubmitInput,
    bulkBatchId: string,
    job: ExpandedVariantJob,
    masterStock: Map<string, number>,
    variantGroupingModel: VariantGroupingModel
  ): EnqueueOfferCreationInput {
    // 3-way precedence (#1741): base sharedConfig → family (perProductOverrides
    // by selectedId) → variant (perVariantOverrides by variantId); the variant
    // layer wins field-by-field, INCLUDING the scalar fields below (not just the
    // `overrides` object).
    const familyOverride: PerProductOverride | undefined =
      input.perProductOverrides?.[job.selectedId];
    const variantOverride: PerProductOverride | undefined =
      input.perVariantOverrides?.[job.variantId];

    const operatorStock =
      variantOverride?.stock ?? familyOverride?.stock ?? input.sharedConfig.stock;
    // Master stock is authoritative for expanded siblings - including 0. A
    // sibling absent from the availability map resolves to 0 (out-of-stock),
    // never the nominal operator quantity (no phantom stock, #1741). The
    // operator quantity is used only for single-variant / passthrough jobs.
    const masterAvailable = job.useMasterStock ? masterStock.get(job.variantId) : undefined;
    const stock = job.useMasterStock ? (masterAvailable ?? 0) : operatorStock;
    const publishImmediately =
      variantOverride?.publishImmediately ??
      familyOverride?.publishImmediately ??
      input.sharedConfig.publishImmediately;
    const price = variantOverride?.price ?? familyOverride?.price ?? input.sharedConfig.price;
    // #1741: a marketplace (Allegro) rejects ACTIVATING a 0-stock offer. A
    // variant resolving to 0 stock is created as a draft (inactive) rather than
    // failing at create; the operator activates it after restock. Applies to
    // both master-authoritative 0 (expanded siblings) and an operator-entered 0.
    const publishEffective = stock > 0 ? publishImmediately : false;
    // Layer overrides base → family → variant; `platformParams` deep-merged
    // across all three so shared keys (e.g. `deliveryPolicyId`, #808) survive.
    // `categoryId` is stripped from the variant tier here (non-destructively)
    // only when the destination's declared `variantGrouping` model requires it
    // (#1924) - a `'parent-child'` shop (or any undeclared/unresolved adapter,
    // via the locked default) cannot carry a per-variant category at all, so
    // it is silently dropped rather than rejected upstream. `'catalog-implicit'`
    // (Allegro) and `'explicit-group'` (Erli) both let the variant tier's
    // categoryId through — Allegro's consequence (splitting the grouped
    // listing) is a downstream FE/operator concern, not something this service
    // polices.
    let overrides = this.mergeOverrides(
      input.sharedConfig.overrides,
      familyOverride?.overrides,
      stripVariantCategoryId(variantOverride?.overrides, variantGroupingModel)
    );
    // Strip the wizard-resolved card for expanded siblings so each self-links
    // by its own barcode - UNLESS the operator explicitly picked a per-variant
    // card (multi-match candidate), which must survive (#1741).
    if (
      job.clearProductCard &&
      overrides?.productCardId !== undefined &&
      variantOverride?.overrides?.productCardId === undefined
    ) {
      const withoutCard: CreateOfferOverrides = { ...overrides };
      delete withoutCard.productCardId;
      overrides = Object.keys(withoutCard).length > 0 ? withoutCard : undefined;
    }

    return {
      internalVariantId: job.variantId,
      connectionId: input.connectionId,
      stock,
      publishImmediately: publishEffective,
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
   * Layer overrides across the three precedence tiers base (`sharedConfig`) →
   * family (`perProductOverrides`) → variant (`perVariantOverrides`), with the
   * later tier winning field-by-field (#1741). Scalar + whole-array fields
   * (title, productCardId, imageUrls, parameters, …) take the latest present
   * value; `platformParams` is **deep-merged** across all three so shared keys
   * (e.g. `deliveryPolicyId`, #808) survive even when a variant supplies its own
   * platform tweaks. Returns `undefined` only when no tier has any overrides, so
   * the enqueue input keeps omitting the field in that case.
   */
  private mergeOverrides(
    shared: CreateOfferOverrides | undefined,
    family: CreateOfferOverrides | undefined,
    variant: CreateOfferOverrides | undefined
  ): CreateOfferOverrides | undefined {
    if (!shared && !family && !variant) return undefined;
    // Scalar + whole-array fields: later layer wins (base → family → variant).
    // `parameters` / `imageUrls` are whole-array-replaced by design (#1741) -
    // the FE emits the full effective array per variant.
    const merged: CreateOfferOverrides = { ...shared, ...family, ...variant };
    if (shared?.platformParams || family?.platformParams || variant?.platformParams) {
      // `platformParams` is deep-merged across all three so shared keys
      // (e.g. `deliveryPolicyId`, #808) survive a per-variant platform tweak.
      merged.platformParams = {
        ...shared?.platformParams,
        ...family?.platformParams,
        ...variant?.platformParams,
      };
    }
    return merged;
  }
}

/**
 * Return a copy of the variant-tier overrides with any `categoryId` removed,
 * conditional on the destination's declared variant-grouping model (#1741,
 * #1924). Only `'parent-child'` (a variation has no `categories` field at
 * all - WooCommerce, and the locked default for any undeclared adapter)
 * strips it; `'catalog-implicit'` (Allegro) and `'explicit-group'` (Erli)
 * both let a per-variant categoryId through. Non-destructive — the caller's
 * input object is never mutated. Returns `undefined` unchanged so
 * `mergeOverrides` keeps omitting an absent tier.
 */
function stripVariantCategoryId(
  overrides: CreateOfferOverrides | undefined,
  variantGroupingModel: VariantGroupingModel
): CreateOfferOverrides | undefined {
  if (!overrides || overrides.categoryId === undefined) return overrides;
  if (variantGroupingModel !== 'parent-child') return overrides;
  const rest: CreateOfferOverrides = { ...overrides };
  delete rest.categoryId;
  return rest;
}

/**
 * True once every child of the batch has terminated
 * (`succeededCount + failedCount === totalCount`) — the #737 counter gate.
 */
function isBatchFinished(batch: BulkListingBatch): boolean {
  return batch.succeededCount + batch.failedCount === batch.totalCount;
}

/**
 * Derive the terminal batch status from its post-reconcile counters (#1741
 * review #1). Same rule as the #737 `BulkListingProgressService`: all-succeeded
 * ⇒ completed, all-failed ⇒ failed, mixed ⇒ partially-failed. Call only when
 * {@link isBatchFinished} holds.
 */
function deriveTerminalStatus(batch: BulkListingBatch): BulkBatchStatus {
  if (batch.failedCount === 0) return BULK_BATCH_STATUS.Completed;
  if (batch.succeededCount === 0) return BULK_BATCH_STATUS.Failed;
  return BULK_BATCH_STATUS.PartiallyFailed;
}

/**
 * GS1 mod-10 check-digit validation for a GTIN-8/12/13/14 (#1741). The trailing
 * digit is the check digit; the preceding body digits are weighted 3,1,3,1,…
 * from the rightmost body digit. Returns false for a non-numeric input. Pure.
 */
function isValidGs1CheckDigit(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  const digits = [...code].map((c) => Number(c));
  const check = digits[digits.length - 1];
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = body.length - 1, pos = 0; i >= 0; i--, pos++) {
    sum += body[i] * (pos % 2 === 0 ? 3 : 1);
  }
  const computed = (10 - (sum % 10)) % 10;
  return computed === check;
}

/*
 * Worker-handler seam: shipped as `BulkListingProgressService.advanceBatchStatus`
 * in #737. The terminal-state derivation rule lives there. See
 * `bulk-listing-progress.service.ts`.
 */
