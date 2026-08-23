/**
 * Marketplace Offer Field Update Handler
 *
 * Handles sync jobs of type 'marketplace.offer.updateFields'. Resolves the
 * internal offer ID to the marketplace-native external ID via IdentifierMappingService,
 * then dispatches the field update to the marketplace adapter.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  MarketplaceOfferFieldUpdatePayloadV1,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import { IIdentifierMappingService, IDENTIFIER_MAPPING_SERVICE_TOKEN, CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import type { OfferManagerPort } from '@openlinker/core/listings';
import {
  formatOfferFieldsForDestination,
  isOfferFieldUpdater,
  resolveOfferDescriptionFormat,
} from '@openlinker/core/listings';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import {
  IProductsService,
  ITaxRateJournalService,
  PRODUCTS_SERVICE_TOKEN,
  TAX_RATE_JOURNAL_SERVICE_TOKEN,
} from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class MarketplaceOfferFieldUpdateHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceOfferFieldUpdateHandler.name);

  constructor(
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    // #2250 - the journal is product-scoped, while an `Offer` mapping's
    // internal id is the VARIANT id, so the owning product is one lookup away.
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(TAX_RATE_JOURNAL_SERVICE_TOKEN)
    private readonly taxRateJournal: ITaxRateJournalService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing marketplace.offer.updateFields job ${job.id} for connection ${job.connectionId} (offerId=${payload.offerId}, fields=${Object.keys(payload.fields).join(',')})`
    );

    // Resolve internal offer ID → external (marketplace-native) offer ID
    const externalMappings = await this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Offer, payload.offerId);
    const mapping = externalMappings.find((m) => m.connectionId === job.connectionId);

    if (!mapping) {
      throw new SyncJobExecutionError(
        `No external offer mapping found for offerId=${payload.offerId} on connection ${job.connectionId}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }

    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      job.connectionId,
      'OfferManager'
    );

    if (!isOfferFieldUpdater(adapter)) {
      throw new SyncJobExecutionError(
        `Adapter for connection ${job.connectionId} does not support updateOfferFields`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }

    try {
      await adapter.updateOfferFields({
        externalOfferId: mapping.externalId,
        // ADR-046: the fourth path that hands a description to a destination -
        // the edit-offer drawer's `marketplace.offer.updateFields` job. It calls
        // the adapter directly, so it applies the declared format itself rather
        // than relying on an adapter-local sanitiser (there is no longer one).
        fields: formatOfferFieldsForDestination(
          payload.fields,
          resolveOfferDescriptionFormat(adapter)
        ),
        idempotencyKey: payload.idempotencyKey,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Marketplace offer field update failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }

    // #2250 (ADR-052 § 4) - the update succeeded, so if it carried a rate,
    // OpenLinker just wrote one onto the channel. Recorded after the call
    // rather than before: the entry is the claim a write HAPPENED, which is
    // what makes a later channel observation carrying a different value
    // evidence that somebody changed it afterwards. Outside the try so a
    // provenance failure can never be reported as an update failure.
    await this.journalWrittenTaxRate(job.connectionId, payload);

    return { outcome: 'ok' };
  }

  /**
   * Journal the rate this update actually wrote onto the channel (#2250).
   *
   * Only when the payload carried one - an update that touched title or price
   * wrote no rate, and an entry claiming otherwise would misattribute a later
   * disagreement. Best-effort and never throws: the offer is already updated on
   * the marketplace, and losing a provenance row must not turn a completed write
   * into a retried one.
   *
   * Known limit of the capability, not of this call site: `updateOfferFields`
   * returns `void`, so an adapter that silently DROPS a field the seller froze
   * (Erli, #988 / ADR-025 §4b) is indistinguishable from one that applied it.
   * A frozen rate would therefore be journalled as written. Making that exact
   * needs `OfferFieldUpdater` to report which fields it applied.
   */
  private async journalWrittenTaxRate(
    connectionId: string,
    payload: MarketplaceOfferFieldUpdatePayloadV1
  ): Promise<void> {
    const taxRate = payload.fields.taxRate;
    if (!taxRate) {
      return;
    }
    try {
      // An `Offer` mapping's internal id IS the internal variant id (every
      // writer of that entityType maps `externalOfferId -> internalVariantId`).
      const variant = await this.productsService.getVariant(payload.offerId);
      if (!variant) {
        this.logger.warn(
          `Offer fields updated but the variant could not be read, so the tax-rate journal entry was skipped. offerId=${payload.offerId} connectionId=${connectionId}`
        );
        return;
      }
      await this.taxRateJournal.record({
        productId: variant.productId,
        variantId: payload.offerId,
        connectionId,
        origin: 'written-by-us',
        taxRate,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Offer fields updated but the tax-rate journal entry failed (provenance only, the offer is unaffected). offerId=${payload.offerId} connectionId=${connectionId} error=${message}`
      );
    }
  }

  private getPayload(job: SyncJob): MarketplaceOfferFieldUpdatePayloadV1 {
    const payload = job.payload as unknown as Partial<MarketplaceOfferFieldUpdatePayloadV1>;

    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }

    if (!payload.offerId || typeof payload.offerId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid offerId in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }

    if (!payload.fields || typeof payload.fields !== 'object') {
      throw new SyncJobExecutionError(
        `Missing or invalid fields in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }

    const { price, title, description, taxRate } = payload.fields;
    if (
      price === undefined &&
      title === undefined &&
      description === undefined &&
      // #2249 — a rate-only update is legitimate: propagating the shop's rate
      // onto a live offer touches nothing else.
      taxRate === undefined
    ) {
      throw new SyncJobExecutionError(
        `At least one field (price, title, description, taxRate) must be present in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }

    return {
      schemaVersion: 1,
      offerId: payload.offerId,
      fields: payload.fields,
      idempotencyKey: payload.idempotencyKey,
    };
  }
}
