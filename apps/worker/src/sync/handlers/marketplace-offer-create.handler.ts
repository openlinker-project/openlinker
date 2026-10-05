/**
 * Marketplace Offer Create Handler
 *
 * Handles sync jobs of type `marketplace.offer.create`. V1 payloads run the
 * original single-offer path: validate payload → `OfferCreationExecutionService.executeCreation`
 * → return outcome.
 *
 * V2 payloads (#737, bulk-flow) layer two orthogonal side-effects:
 *
 *   1. **Before** `executeCreation`: if `generateDescription === true`,
 *      call `ContentSuggestionService.suggestDescription({ channel })` with
 *      the channel resolved from the job's own connection `platformType`
 *      (#2202 — never a hardcoded `'allegro'`, since this handler serves
 *      every marketplace offer create, not only Allegro) and thread the
 *      result into `overrides.description`. AI failure falls through —
 *      operator override or builder default takes over (AC-9).
 *   2. **After** `executeCreation`, terminal outcome: advance the parent
 *      batch's counters via `BulkListingProgressService` — which
 *      gates on the `bulk_batch_advancements` table to give at-most-once
 *      counter semantics across retries + concurrent workers.
 *
 * `onDead` (#3505, G01-2): once the runner marks the job dead, a record still
 * `pending` is settled as `failed` and a bulk child is counted as failed —
 * otherwise both stayed "in progress" for ever.
 *
 * Smart classification readback lives inside `OfferCreationExecutionService`
 * (active-on-create branch) and `OfferStatusPollService` (validating→active
 * branch) so the handler stays cross-context-clean — no repository-port
 * imports.
 *
 * Per `architecture-overview.md` §7, orchestration policies live in core
 * application services; the handler is a thin shell coordinating them.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';

import {
  CONTENT_SUGGESTION_SERVICE_TOKEN,
  type IContentSuggestionService,
} from '@openlinker/core/content';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import {
  BULK_LISTING_PROGRESS_SERVICE_TOKEN,
  type BulkChildOutcome,
  type CreateOfferOverrides,
  type IBulkListingProgressService,
  type IOfferCreationExecutionService,
  OFFER_CREATION_EXECUTION_SERVICE_TOKEN,
  OfferCreationInvariantException,
} from '@openlinker/core/listings';
import {
  PRODUCTS_SERVICE_TOKEN,
  type IProductsService,
} from '@openlinker/core/products';
import type {
  MarketplaceOfferCreatePayloadV1,
  MarketplaceOfferCreatePayloadV2,
  SyncJob as SyncJobEntity,
  SyncJobDeadFailure,
  SyncJobHandler,
  SyncJobHandlerResult,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;
type Payload = MarketplaceOfferCreatePayloadV1 | MarketplaceOfferCreatePayloadV2;

@Injectable()
export class MarketplaceOfferCreateHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceOfferCreateHandler.name);

  constructor(
    @Inject(OFFER_CREATION_EXECUTION_SERVICE_TOKEN)
    private readonly offerCreation: IOfferCreationExecutionService,
    @Inject(CONTENT_SUGGESTION_SERVICE_TOKEN)
    private readonly contentSuggestion: IContentSuggestionService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly products: IProductsService,
    @Inject(BULK_LISTING_PROGRESS_SERVICE_TOKEN)
    private readonly bulkProgress: IBulkListingProgressService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing marketplace.offer.create job ${job.id} variant=${payload.internalVariantId} connection=${job.connectionId} schemaVersion=${payload.schemaVersion}`
    );

    try {
      const overrides = await this.maybeRunAiDescription(payload, job.connectionId);

      const { offerCreationRecord, outcome } = await this.offerCreation.executeCreation({
        internalVariantId: payload.internalVariantId,
        connectionId: job.connectionId,
        stock: payload.stock,
        publishImmediately: payload.publishImmediately,
        price: payload.price,
        overrides,
        // #1500 — forward the neutral condition end-to-end so a programmatic /
        // bulk-retry payload's choice reaches the adapter; absent → builder
        // defaults to 'new'.
        condition: payload.condition,
        idempotencyKey: payload.idempotencyKey,
        offerCreationRecordId: payload.offerCreationRecordId,
      });

      this.logger.log(
        `Offer creation finished: job=${job.id} recordId=${offerCreationRecord.id} status=${offerCreationRecord.status} outcome=${outcome} externalOfferId=${offerCreationRecord.externalOfferId ?? 'n/a'}`
      );

      if (this.isV2(payload)) {
        // Counter advancement — gated at-most-once by
        // `bulk_batch_advancements` inside the progress service.
        const batchOutcome: BulkChildOutcome = outcome === 'ok' ? 'succeeded' : 'failed';
        await this.bulkProgress.advanceBatchStatus(
          payload.bulkBatchId,
          offerCreationRecord.id,
          batchOutcome
        );
      }

      return { outcome };
    } catch (error) {
      // OfferCreationInvariantException is a code bug — propagate untouched so
      // the runner classifies it as non-retryable (markDead). Wrapping it in a
      // SyncJobExecutionError would route it through the retry path, which is
      // pointless for an invariant violation.
      if (error instanceof OfferCreationInvariantException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `marketplace.offer.create job failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * The job is dead (#3505, G01-2): settle the record it was creating so it
   * stops reading as "in progress", and — for a bulk child — count it as a
   * failed child so the batch can still reach a terminal state.
   *
   * The batch is advanced only when THIS call moved the record out of
   * `pending`: a record a previous attempt already settled has been (or will
   * be) counted by `execute`, and `bulk_batch_advancements` would dedupe a
   * second advance anyway. A payload carrying no record id (a legacy V1 job
   * whose record `executeCreation` creates itself) has nothing to settle.
   */
  async onDead(job: SyncJob, failure: SyncJobDeadFailure): Promise<void> {
    let payload: Payload;
    try {
      payload = this.getPayload(job);
    } catch {
      // An unparseable payload is why some jobs die; there is no record to name.
      return;
    }
    if (!payload.offerCreationRecordId) {
      return;
    }

    const abandoned = await this.offerCreation.abandonCreation(
      payload.offerCreationRecordId,
      failure.message
    );
    if (abandoned && this.isV2(payload)) {
      await this.bulkProgress.advanceBatchStatus(payload.bulkBatchId, abandoned.id, 'failed');
    }
  }

  private isV2(p: Payload): p is MarketplaceOfferCreatePayloadV2 {
    return p.schemaVersion === 2;
  }

  /**
   * V2-only: when `generateDescription === true`, run the AI suggestion and
   * thread the result into `overrides.description`. AI failure logs a warning
   * and falls through (operator override or builder default takes over).
   *
   * V1 (or V2 with `generateDescription: false`) returns payload.overrides
   * unchanged.
   */
  private async maybeRunAiDescription(
    payload: Payload,
    connectionId: string
  ): Promise<CreateOfferOverrides | undefined> {
    if (!this.isV2(payload) || payload.generateDescription !== true) {
      return payload.overrides;
    }

    let productId: string;
    try {
      const variant = await this.products.getVariant(payload.internalVariantId);
      if (!variant) {
        this.logger.warn(
          `AI description skipped — variant not found: ${payload.internalVariantId}`
        );
        return payload.overrides;
      }
      productId = variant.productId;
    } catch (err) {
      this.logger.warn(
        `AI description skipped — variant lookup failed: ${(err as Error).message}`
      );
      return payload.overrides;
    }

    // Channel resolves from the connection's own platformType (#2202) —
    // never a hardcoded literal — matching ContentEditor's approach.
    // `PromptTemplateService.render` does an EXACT (key, channel) match and
    // throws `PromptTemplateNotFoundException` when nothing is published for
    // it — there is no channel→master fallback. A platform with no seeded
    // template (or an unresolved connection, below) therefore produces no AI
    // description at all; the `catch` around `suggestDescription` below is
    // what keeps that non-fatal (AC-9), not a backend fallback.
    //
    // This is a metadata-only lookup (`getAdapter`, never
    // `getCapabilityAdapter`) and deliberately re-fetches the same
    // connection `executeCreation` resolves moments later for the actual
    // destination adapter — accepted per the issue's own assumption that a
    // second read is cheap on a path already making an LLM call.
    let channel: string;
    try {
      const { connection } = await this.integrationsService.getAdapter(connectionId);
      channel = connection.platformType;
    } catch (err) {
      this.logger.warn(
        `AI description skipped — connection lookup failed: ${(err as Error).message}`
      );
      return payload.overrides;
    }

    try {
      const result = await this.contentSuggestion.suggestDescription({
        productId,
        channel,
        tone: payload.descriptionTone,
      });
      return {
        ...payload.overrides,
        description: result.suggestion,
      };
    } catch (err) {
      this.logger.warn(
        `AI description failed (falling back to operator override / default): ${(err as Error).message}`
      );
      return payload.overrides;
    }
  }

  private getPayload(job: SyncJob): Payload {
    const payload = job.payload as unknown as Partial<MarketplaceOfferCreatePayloadV1 | MarketplaceOfferCreatePayloadV2>;

    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }

    if (payload.schemaVersion === 1) {
      return this.validateV1(job, payload);
    }
    if (payload.schemaVersion === 2) {
      return this.validateV2(job, payload);
    }
    throw new SyncJobExecutionError(
      `Unsupported schemaVersion (${String(payload.schemaVersion)}) in payload: ${JSON.stringify(job.payload)}`,
      job.id,
      job.jobType,
      job.connectionId
    );
  }

  private validateV1(
    job: SyncJob,
    payload: Partial<MarketplaceOfferCreatePayloadV1>
  ): MarketplaceOfferCreatePayloadV1 {
    if (typeof payload.internalVariantId !== 'string' || payload.internalVariantId.length === 0) {
      throw new SyncJobExecutionError(
        `Missing or invalid internalVariantId in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (
      typeof payload.stock !== 'number' ||
      !Number.isInteger(payload.stock) ||
      payload.stock < 0
    ) {
      throw new SyncJobExecutionError(
        `Missing or invalid stock in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (typeof payload.publishImmediately !== 'boolean') {
      throw new SyncJobExecutionError(
        `Missing or invalid publishImmediately in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    return {
      schemaVersion: 1,
      internalVariantId: payload.internalVariantId,
      stock: payload.stock,
      publishImmediately: payload.publishImmediately,
      price: payload.price,
      overrides: payload.overrides,
      idempotencyKey: payload.idempotencyKey,
      offerCreationRecordId: payload.offerCreationRecordId,
    };
  }

  private validateV2(
    job: SyncJob,
    payload: Partial<MarketplaceOfferCreatePayloadV2>
  ): MarketplaceOfferCreatePayloadV2 {
    if (typeof payload.internalVariantId !== 'string' || payload.internalVariantId.length === 0) {
      throw new SyncJobExecutionError(
        `Missing or invalid internalVariantId in V2 payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (
      typeof payload.stock !== 'number' ||
      !Number.isInteger(payload.stock) ||
      payload.stock < 0
    ) {
      throw new SyncJobExecutionError(
        `Missing or invalid stock in V2 payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (typeof payload.publishImmediately !== 'boolean') {
      throw new SyncJobExecutionError(
        `Missing or invalid publishImmediately in V2 payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (typeof payload.offerCreationRecordId !== 'string' || payload.offerCreationRecordId.length === 0) {
      throw new SyncJobExecutionError(
        `Missing offerCreationRecordId in V2 payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (typeof payload.bulkBatchId !== 'string' || payload.bulkBatchId.length === 0) {
      throw new SyncJobExecutionError(
        `Missing bulkBatchId in V2 payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (typeof payload.generateDescription !== 'boolean') {
      throw new SyncJobExecutionError(
        `Missing or invalid generateDescription in V2 payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    return {
      schemaVersion: 2,
      internalVariantId: payload.internalVariantId,
      stock: payload.stock,
      publishImmediately: payload.publishImmediately,
      price: payload.price,
      overrides: payload.overrides,
      idempotencyKey: payload.idempotencyKey,
      offerCreationRecordId: payload.offerCreationRecordId,
      bulkBatchId: payload.bulkBatchId,
      generateDescription: payload.generateDescription,
      descriptionTone: payload.descriptionTone,
    };
  }
}
