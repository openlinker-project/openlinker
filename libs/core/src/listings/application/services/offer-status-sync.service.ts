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
 * Also persists channel-side commercial data (#2024): whenever the SAME
 * `getOfferStatus` response carries a `commercial` observation (Allegro and
 * Erli both populate it off the identical per-offer fetch already made for
 * status — no second marketplace call), it is upserted into
 * `offer_commercial_snapshots`. An adapter that never populates `commercial`
 * skips the commercial upsert for that offer, as does an observation carrying
 * neither a price nor a quantity, and a failing commercial write is caught and
 * warn-logged - the commercial half is supplementary and can never abort the
 * status pass or stall its scan cursor.
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
import { OfferCommercialSnapshotRepositoryPort } from '../../domain/ports/offer-commercial-snapshot-repository.port';
import {
  OFFER_MAPPING_REPOSITORY_TOKEN,
  OFFER_STATUS_SNAPSHOT_REPOSITORY_TOKEN,
  OFFER_COMMERCIAL_SNAPSHOT_REPOSITORY_TOKEN,
} from '../../listings.tokens';
import type {
  IOfferStatusSyncService,
  OfferStatusRefreshTarget,
  OfferStatusSyncOptions,
} from './offer-status-sync.service.interface';
import type { OfferStatusSyncResult } from '../../domain/types/offer-status-snapshot.types';
import type { OfferCommercialWriteOutcome } from '../../domain/types/offer-commercial-snapshot.types';
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
    private readonly snapshots: OfferStatusSnapshotRepositoryPort,
    @Inject(OFFER_COMMERCIAL_SNAPSHOT_REPOSITORY_TOKEN)
    private readonly commercialSnapshots: OfferCommercialSnapshotRepositoryPort
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
      return {
        scanned: 0,
        updated: 0,
        transitioned: 0,
        notFound: 0,
        total: 0,
        nextOffset: 0,
        commercialUpdated: 0,
        commercialFailed: 0,
      };
    }

    const page = await this.offerMappings.findMappingPage({ connectionId }, { limit, offset });
    const items = page.items;

    let updated = 0;
    let transitioned = 0;
    let notFound = 0;
    let commercialUpdated = 0;
    let commercialFailed = 0;

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

      const commercialOutcome = await this.upsertCommercialSnapshot(
        connectionId,
        externalOfferId,
        internalVariantId,
        status
      );
      switch (commercialOutcome) {
        case 'written':
          commercialUpdated += 1;
          break;
        case 'failed':
          commercialFailed += 1;
          break;
        case 'skipped':
          break;
      }
    }

    const proposedNext = offset + limit;
    const nextOffset = proposedNext >= page.total ? 0 : proposedNext;

    this.logger.log(
      `Offer-status sync (connection=${connectionId}): scanned=${items.length}, updated=${updated}, transitioned=${transitioned}, notFound=${notFound}, commercialUpdated=${commercialUpdated}, commercialFailed=${commercialFailed}, offset=${offset}→${nextOffset}/${page.total}`
    );

    return {
      scanned: items.length,
      updated,
      transitioned,
      notFound,
      total: page.total,
      nextOffset,
      commercialUpdated,
      commercialFailed,
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

    await this.upsertCommercialSnapshot(
      connectionId,
      target.externalOfferId,
      target.internalVariantId,
      status
    );

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

  /**
   * Upsert `offer_commercial_snapshots` (#2024) from the `commercial`
   * observation already carried on the `getOfferStatus` result — no second
   * per-offer marketplace call. An absent `commercial` (the adapter doesn't
   * populate it) is a silent no-op, and so is an observation carrying neither
   * axis: the upsert overwrites every field, so writing one would blank a
   * previously-good row AND advance its freshness stamp, leaving the operator
   * reading "no data, synced a minute ago" where the truth is "34.90, synced
   * two days ago" — and the scan cursor only returns hours or days later. A
   * single-axis observation IS written, `null` on the missing half, because a
   * good quantity must not be discarded because the price was missing.
   *
   * The commercial half is strictly supplementary to the #816 status sync, so
   * a failed write must never abort the caller: an unguarded throw inside the
   * per-offer loop would cost every remaining offer on the page its status
   * refresh AND skip the `nextOffset` computation, re-reading the same poison
   * page forever. Same posture as the Smart-classification readback in the
   * Allegro adapter, which must not fail the offer-creation job.
   */
  private async upsertCommercialSnapshot(
    connectionId: string,
    externalOfferId: string,
    internalVariantId: string,
    status: OfferStatusReadResult
  ): Promise<OfferCommercialWriteOutcome> {
    const commercial = status.commercial;
    if (!commercial) {
      return 'skipped';
    }
    if (commercial.price === null && commercial.availableQuantity === null) {
      this.logger.debug(
        `Commercial observation carried neither price nor quantity (connection=${connectionId}, offerId=${externalOfferId}); leaving the prior snapshot and its freshness stamp intact`
      );
      return 'skipped';
    }
    try {
      await this.commercialSnapshots.upsert({
        connectionId,
        externalOfferId,
        internalVariantId,
        price: commercial.price?.amount ?? null,
        currency: commercial.price?.currency ?? null,
        availableQuantity: commercial.availableQuantity,
        lastCommercialSyncedAt: new Date(),
      });
      return 'written';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Pass the Error itself, not its `.stack`: LoggerPort treats a trailing
      // STRING param as the per-call context, so a stack string would replace
      // the class-name context and key the Nest per-context logger cache -
      // which grows for the process lifetime, on exactly the systemic failure
      // this counter exists to surface.
      this.logger.warn(
        `Failed to persist commercial snapshot (connection=${connectionId}, offerId=${externalOfferId}): ${message}; status snapshot is unaffected`,
        error
      );
      return 'failed';
    }
  }
}
