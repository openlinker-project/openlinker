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
import {
  SyncJobHandler,
  SyncJob as SyncJobEntity,
  SyncJobExecutionError,
  MarketplaceOfferFieldUpdatePayloadV1,
} from '@openlinker/core/sync';
import {
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
} from '@openlinker/core/identifier-mapping';
import { OfferManagerPort } from '@openlinker/core/listings';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
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
  ) {}

  async execute(job: SyncJob): Promise<void> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing marketplace.offer.updateFields job ${job.id} for connection ${job.connectionId} (offerId=${payload.offerId}, fields=${Object.keys(payload.fields).join(',')})`,
    );

    // Resolve internal offer ID → external (marketplace-native) offer ID
    const externalMappings = await this.identifierMapping.getExternalIds('Offer', payload.offerId);
    const mapping = externalMappings.find((m) => m.connectionId === job.connectionId);

    if (!mapping) {
      throw new SyncJobExecutionError(
        `No external offer mapping found for offerId=${payload.offerId} on connection ${job.connectionId}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      job.connectionId,
      'OfferManager',
    );

    if (!adapter.updateOfferFields) {
      throw new SyncJobExecutionError(
        `Adapter for connection ${job.connectionId} does not support updateOfferFields`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    try {
      await adapter.updateOfferFields({
        externalOfferId: mapping.externalId,
        fields: payload.fields,
        idempotencyKey: payload.idempotencyKey,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Marketplace offer field update failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
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
        job.connectionId,
      );
    }

    if (!payload.offerId || typeof payload.offerId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid offerId in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    if (!payload.fields || typeof payload.fields !== 'object') {
      throw new SyncJobExecutionError(
        `Missing or invalid fields in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    const { price, title, description } = payload.fields;
    if (price === undefined && title === undefined && description === undefined) {
      throw new SyncJobExecutionError(
        `At least one field (price, title, description) must be present in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
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
