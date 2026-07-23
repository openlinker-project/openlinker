/**
 * Offer Status Sync Service
 *
 * Steady-state refresh of marketplace offer publication status (#816). For one
 * page of a connection's mapped offers it reads the live status via the
 * `OfferStatusReader` capability and persists it into `offer_status_snapshots`,
 * logging when an offer's status changes versus the prior snapshot.
 *
 * Distinct from `OfferStatusPollService` (#447): that follows a single
 * freshly-created offer through `validating → active|draft` and writes
 * `OfferCreationRecord`. This service never touches `OfferCreationRecord` and
 * runs on its own schedule + cursor — the two never write the same row.
 *
 * Enumeration uses OL's own offer mappings (Allegro has no bulk status
 * endpoint); the worker handler pages via a rolling scan offset.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IOfferStatusSyncService}
 */
import { Injectable, Inject } from '@nestjs/common';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type {
  OfferManagerPort,
  OfferStatusReadResult
} from '@openlinker/core/listings';
import { isOfferStatusReader, OfferNotFoundOnMarketplaceException ,
  OfferMappingRepositoryPort} from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';
import { OfferStatusSnapshotRepositoryPort } from '../../domain/ports/offer-status-snapshot-repository.port';
import type { OfferStatusSnapshotDetails } from '../../domain/types/offer-status-snapshot.types';
import {
  OFFER_MAPPING_REPOSITORY_TOKEN,
  OFFER_STATUS_SNAPSHOT_REPOSITORY_TOKEN,
} from '../../listings.tokens';
import type {
  IOfferStatusSyncService,
  OfferStatusRefreshTarget,
  OfferStatusSyncOptions,
} from './offer-status-sync.service.interface';
import type { OfferStatusSyncResult } from '../../domain/types/offer-status-snapshot.types';
import type { OfferPublicationStatus } from '../../domain/types/offer-status-read.types';

@Injectable()
export class OfferStatusSyncService implements IOfferStatusSyncService {
  private readonly logger = new Logger(OfferStatusSyncService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(OFFER_MAPPING_REPOSITORY_TOKEN)
    private readonly offerMappings: OfferMappingRepositoryPort,
    @Inject(OFFER_STATUS_SNAPSHOT_REPOSITORY_TOKEN)
    private readonly snapshots: OfferStatusSnapshotRepositoryPort
  ) {}

  async sync(
    connectionId: string,
    options: OfferStatusSyncOptions
  ): Promise<OfferStatusSyncResult> {
    const offset = options.offset ?? 0;
    const limit = options.limit;

    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager'
    );
    if (!isOfferStatusReader(adapter)) {
      this.logger.warn(
        `Connection ${connectionId} adapter does not support OfferStatusReader; skipping offer-status sync`
      );
      return { scanned: 0, updated: 0, transitioned: 0, notFound: 0, total: 0, nextOffset: 0 };
    }

    const page = await this.offerMappings.findMany({ connectionId }, { limit, offset });
    const items = page.items;

    let updated = 0;
    let transitioned = 0;
    let notFound = 0;

    for (const mapping of items) {
      const externalOfferId = mapping.externalId;
      const internalVariantId = mapping.internalId;

      let status: OfferStatusReadResult;
      try {
        status = await adapter.getOfferStatus(externalOfferId);
      } catch (error) {
        if (error instanceof OfferNotFoundOnMarketplaceException) {
          notFound += 1;
          this.logger.debug(
            `Offer not found on marketplace (connection=${connectionId}, offerId=${externalOfferId}); leaving snapshot unchanged`
          );
          continue;
        }
        throw error;
      }

      const { previousStatus } = await this.snapshots.upsert({
        connectionId,
        externalOfferId,
        internalVariantId,
        publicationStatus: status.publicationStatus,
        statusDetails: this.toStatusDetails(status.validationErrors),
        lastStatusSyncedAt: new Date(),
      });
      updated += 1;

      if (previousStatus !== null && previousStatus !== status.publicationStatus) {
        transitioned += 1;
        this.logger.log(
          `Offer status transition (connection=${connectionId}, offerId=${externalOfferId}): ${previousStatus} → ${status.publicationStatus}`
        );
      }
    }

    const proposedNext = offset + limit;
    const nextOffset = proposedNext >= page.total ? 0 : proposedNext;

    this.logger.log(
      `Offer-status sync (connection=${connectionId}): scanned=${items.length}, updated=${updated}, transitioned=${transitioned}, notFound=${notFound}, offset=${offset}→${nextOffset}/${page.total}`
    );

    return {
      scanned: items.length,
      updated,
      transitioned,
      notFound,
      total: page.total,
      nextOffset,
    };
  }

  async refreshOne(
    connectionId: string,
    target: OfferStatusRefreshTarget
  ): Promise<OfferPublicationStatus | null> {
    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager'
    );
    if (!isOfferStatusReader(adapter)) {
      this.logger.warn(
        `Connection ${connectionId} adapter does not support OfferStatusReader; skipping single-offer refresh`
      );
      return null;
    }

    let status: OfferStatusReadResult;
    try {
      status = await adapter.getOfferStatus(target.externalOfferId);
    } catch (error) {
      if (error instanceof OfferNotFoundOnMarketplaceException) {
        this.logger.debug(
          `Offer not found on marketplace during refresh (connection=${connectionId}, offerId=${target.externalOfferId}); leaving snapshot unchanged`
        );
        return null;
      }
      throw error;
    }

    const { previousStatus } = await this.snapshots.upsert({
      connectionId,
      externalOfferId: target.externalOfferId,
      internalVariantId: target.internalVariantId,
      publicationStatus: status.publicationStatus,
      statusDetails: this.toStatusDetails(status.validationErrors),
      lastStatusSyncedAt: new Date(),
    });

    if (previousStatus !== null && previousStatus !== status.publicationStatus) {
      this.logger.log(
        `Offer status transition on refresh (connection=${connectionId}, offerId=${target.externalOfferId}): ${previousStatus} → ${status.publicationStatus}`
      );
    }

    return status.publicationStatus;
  }

  private toStatusDetails(
    validationErrors: ReadonlyArray<{ message: string }>
  ): OfferStatusSnapshotDetails | null {
    if (validationErrors.length === 0) {
      return null;
    }
    return { validationMessages: validationErrors.map((error) => error.message) };
  }
}
