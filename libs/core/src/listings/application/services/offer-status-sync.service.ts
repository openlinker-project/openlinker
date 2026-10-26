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
  OfferMappingRepositoryPort, toOfferValidationProblem} from '@openlinker/core/listings';
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
  OfferStatusObservation,
  OfferStatusRefreshTarget,
  OfferStatusSyncOptions,
} from './offer-status-sync.service.interface';
import type { OfferStatusSyncResult } from '../../domain/types/offer-status-snapshot.types';
import type { OfferCommercialWriteOutcome } from '../../domain/types/offer-commercial-snapshot.types';
import type { OfferPublicationStatus } from '../../domain/types/offer-status-read.types';
import type { OfferValidationScope } from '../../domain/types/offer-validation-problem.types';

/**
 * The status an offer the marketplace reports as not found is recorded with.
 * `ended` is the one status the duplicate guard treats as re-listable, which is
 * exactly what a vanished offer is.
 */
const OFFER_GONE_STATUS: OfferPublicationStatus = 'ended';

/**
 * How old an offer mapping must be before a not-found read is trusted as the
 * offer being gone. Allegro accepts a create with a 202 and builds the offer
 * asynchronously, and right after that it can briefly answer 404 for an offer
 * that is about to exist. Recording that as `ended` would make the variant
 * re-listable at once, and the wizard would then allow a duplicate listing of
 * an offer that goes live minutes later. Thirty minutes is well past the
 * creation poller's ~9-minute budget, so by then a 404 is the marketplace's
 * settled answer; a younger not-found leaves the snapshot alone for the next
 * pass to re-check.
 */
export const OFFER_GONE_MIN_MAPPING_AGE_MS = 30 * 60 * 1000;

/** Page size for finding one variant's offer mappings on a connection. */
const VARIANT_MAPPING_LOOKUP_LIMIT = 100;

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
      let observedAt: Date;
      try {
        status = await adapter.getOfferStatus(externalOfferId);
        // The freshness guard compares observation instants, so stamp the row
        // with when the marketplace was actually read, not when we got around
        // to writing it.
        observedAt = new Date();
      } catch (error) {
        if (error instanceof OfferNotFoundOnMarketplaceException) {
          notFound += 1;
          // The marketplace answered that the offer no longer exists (a draft
          // deleted in the seller panel, an offer removed by the platform), so
          // it is recorded as ended. Leaving the last snapshot in place kept the
          // variant counted as "already listed" by the bulk wizard's duplicate
          // guard for ever, with nothing left on the marketplace to end - the
          // #1934 dead end reached by deletion instead of ending.
          if (!this.isOldEnoughToConcludeGone(mapping.createdAt, connectionId, externalOfferId)) {
            continue;
          }
          if (
            await this.recordObservedStatus(
              connectionId,
              { externalOfferId, internalVariantId },
              { publicationStatus: OFFER_GONE_STATUS, validationMessages: [], observedAt: new Date() }
            )
          ) {
            updated += 1;
          }
          continue;
        }
        throw error;
      }

      const { previousStatus, applied } = await this.snapshots.upsert({
        connectionId,
        externalOfferId,
        internalVariantId,
        publicationStatus: status.publicationStatus,
        statusDetails: this.toStatusDetails(status.validationErrors),
        lastStatusSyncedAt: observedAt,
      });

      // The table is multi-writer since #2039, so the freshness guard may have
      // rejected this observation. Counting or narrating a transition then
      // would report a write that did not happen.
      if (!applied) {
        this.logger.debug(
          `Stale offer-status observation discarded (connection=${connectionId}, offerId=${externalOfferId}); a fresher snapshot is already stored`
        );
        continue;
      }
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
    let observedAt: Date;
    try {
      status = await adapter.getOfferStatus(target.externalOfferId);
      observedAt = new Date();
    } catch (error) {
      if (error instanceof OfferNotFoundOnMarketplaceException) {
        // See `sync`: an offer the marketplace no longer has is ended, so the
        // variant can be listed again. No commercial snapshot - there is
        // nothing on the marketplace to observe a price or stock on. A young
        // mapping's not-found is not trusted yet; `null` is the "not found"
        // answer the interface documents, and the hourly pass re-checks it.
        const mappedAt = await this.findMappedAt(connectionId, target);
        if (!this.isOldEnoughToConcludeGone(mappedAt, connectionId, target.externalOfferId)) {
          return null;
        }
        await this.recordObservedStatus(connectionId, target, {
          publicationStatus: OFFER_GONE_STATUS,
          validationMessages: [],
          observedAt: new Date(),
        });
        return OFFER_GONE_STATUS;
      }
      throw error;
    }

    const applied = await this.recordObservedStatus(connectionId, target, {
      publicationStatus: status.publicationStatus,
      validationMessages: status.validationErrors.map((error) => error.message),
      // Threaded through as well as flattened (#2231): the observation shape is
      // the ONLY hop between the adapter's read and the snapshot on this path,
      // so dropping the codes and scopes here would make the manual "Refresh"
      // action quietly downgrade a snapshot the hourly sync writes in full.
      validationProblems: status.validationErrors.map(toOfferValidationProblem),
      observedAt,
    });

    // Gated on the status write actually landing: `recordObservedStatus`
    // discards an observation older than the stored snapshot, and the
    // commercial table has no freshness guard of its own (last write wins),
    // so an ungated write here would let a stale read overwrite fresher
    // price/quantity and re-stamp it as just-synced.
    if (applied) {
      await this.upsertCommercialSnapshot(
        connectionId,
        target.externalOfferId,
        target.internalVariantId,
        status
      );
    }

    return status.publicationStatus;
  }

  async recordObservedStatus(
    connectionId: string,
    target: OfferStatusRefreshTarget,
    observation: OfferStatusObservation
  ): Promise<boolean> {
    const { previousStatus, applied } = await this.snapshots.upsert({
      connectionId,
      externalOfferId: target.externalOfferId,
      internalVariantId: target.internalVariantId,
      publicationStatus: observation.publicationStatus,
      statusDetails: this.toStatusDetails(
        observation.validationProblems ??
          (observation.validationMessages ?? []).map((message) => ({ code: '', message }))
      ),
      lastStatusSyncedAt: observation.observedAt ?? new Date(),
    });

    // See `sync` above: a rejected write must not narrate a transition.
    if (!applied) {
      this.logger.debug(
        `Stale offer-status observation discarded (connection=${connectionId}, offerId=${target.externalOfferId}); a fresher snapshot is already stored`
      );
      return false;
    }

    if (previousStatus !== null && previousStatus !== observation.publicationStatus) {
      this.logger.log(
        `Offer status transition (connection=${connectionId}, offerId=${target.externalOfferId}): ${previousStatus} → ${observation.publicationStatus}`
      );
    }

    return true;
  }

  /**
   * Build the detail blob from whatever the reader reported.
   *
   * `validationMessages` stays first and stays the field the lifecycle rule and
   * its SQL twin read, so this change cannot move a row between the Draft and
   * Invalid buckets; `validationProblems` is the additive structured half the
   * row, the panel and the connection banner read.
   *
   * `validationProblems` is OMITTED when it would carry nothing the flattened
   * messages do not already say - no code, no summary, offer scope throughout.
   * The legacy create path is exactly that case, and writing a structured half
   * for it stopped the readers' "absent ⇒ fall back to `validationMessages`"
   * path from ever firing on newly written snapshots, leaving two stories for
   * one state. Omission keeps it one.
   */
  /**
   * Whether a not-found read may be recorded as the offer being gone. An
   * unknown mapping age (no mapping left to date it) is treated as too young:
   * failing towards "re-check later" can only delay a re-listing, while
   * failing the other way can allow a duplicate one.
   */
  private isOldEnoughToConcludeGone(
    mappedAt: Date | null,
    connectionId: string,
    externalOfferId: string
  ): boolean {
    const oldEnough =
      mappedAt !== null && Date.now() - mappedAt.getTime() >= OFFER_GONE_MIN_MAPPING_AGE_MS;
    if (!oldEnough) {
      this.logger.debug(
        `Offer not found on the marketplace but its mapping is too young to trust that; leaving the snapshot for the next pass (connection=${connectionId}, offerId=${externalOfferId})`
      );
    }
    return oldEnough;
  }

  /** When OL first mapped this offer, or `null` when no mapping is left. */
  private async findMappedAt(
    connectionId: string,
    target: OfferStatusRefreshTarget
  ): Promise<Date | null> {
    const page = await this.offerMappings.findMappingPage(
      { connectionId, internalId: target.internalVariantId, search: target.externalOfferId },
      { limit: VARIANT_MAPPING_LOOKUP_LIMIT, offset: 0 }
    );
    // `search` is a substring match, so the exact id is picked out here.
    const mapping = page.items.find((item) => item.externalId === target.externalOfferId);
    return mapping?.createdAt ?? null;
  }

  private toStatusDetails(
    validationErrors: ReadonlyArray<{
      code?: string;
      message: string;
      summary?: string;
      scope?: OfferValidationScope;
    }>
  ): OfferStatusSnapshotDetails | null {
    if (validationErrors.length === 0) {
      return null;
    }
    const validationMessages = validationErrors.map((error) => error.message);
    const validationProblems = validationErrors.map((error) => toOfferValidationProblem(error));
    const addsNothing = validationProblems.every(
      (problem) =>
        problem.code === undefined && problem.summary === undefined && problem.scope === 'offer'
    );
    return {
      validationMessages,
      ...(addsNothing ? {} : { validationProblems }),
    };
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
