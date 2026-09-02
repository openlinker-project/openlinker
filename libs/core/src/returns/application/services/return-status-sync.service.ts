/**
 * Return Status Sync Service
 *
 * Pass 2 of returns ingestion (#2330, ADR-060) — the bounded re-read that is
 * the ONLY way OL ever observes a return moving.
 *
 * ## Why this pass has to exist at all
 *
 * The discovery cursor is defined over CREATION. A return that goes
 * `CREATED -> DELIVERED -> FINISHED` after the cursor passed it is invisible to
 * that cursor forever, and no shipped source publishes a return event or an
 * `updatedAt` to subscribe to instead (SPIKE-2289 E7/E8). Re-reading is not a
 * fallback here; it is the entire change-detection channel. An implementation
 * that collapses discovery and lifecycle into one pass silently stops observing
 * every transition after creation — which reads, from the outside, exactly like
 * a marketplace where nothing ever gets refunded.
 *
 * ## What bounds it, in the order the bounds bind
 *
 *  1. **The adapter's declared terminal vocabulary** — excluded in the SQL, so
 *     a finished return is never fetched at all. Opaque set membership; core
 *     never interprets a member.
 *  2. **An age bound** — non-optional, because bound 1 is only as good as the
 *     adapter's list. A source that adds a status the adapter has not learned
 *     would otherwise pin those returns in the candidate set permanently.
 *  3. **The page budget** — one page per run, rolling scan offset, wrapping at
 *     the total. The `marketplace.offer.statusSync` (#816) shape.
 *
 * Bound 1 may legitimately be absent (an adapter compiled before the hint
 * existed, or a source with no stable terminal vocabulary). That is a degraded
 * mode, not a broken one, and the result says so rather than leaving an
 * operator to wonder why `scanned` is larger than they expected.
 *
 * ## Terminal-at-source never means terminal-at-OL
 *
 * Everything above uses the source's terminal statuses to decide what to STOP
 * ASKING ABOUT. Nothing here writes an OL disposition, closes a return, or
 * touches custody. A terminal source status is not an OL decision — reading it
 * as one would hand a marketplace authority ADR-060 deliberately places with the
 * operator. Self-healing follows for free: once a re-read persists a terminal
 * `rawStatus`, the row drops out of the next run's candidate set by itself.
 *
 * @module libs/core/src/returns/application/services
 * @implements {IReturnStatusSyncService}
 * @see docs/plans/analysis/SPIKE-2289-allegro-returns-feed.md
 */
import { Inject, Injectable } from '@nestjs/common';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { OrderSourcePort, ReturnSourceReader } from '@openlinker/core/orders';
import { isReturnSourceReader } from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';
import { ReturnRepositoryPort } from '../../domain/ports/return-repository.port';
import type { ReturnSourceSweepFilter } from '../../domain/types/return-sweep.types';
import { RETURN_REPOSITORY_TOKEN, RETURNS_SERVICE_TOKEN } from '../../returns.tokens';
import { IReturnsService } from './returns.service.interface';
import type {
  IReturnStatusSyncService,
  ReturnStatusSyncOptions,
  ReturnStatusSyncResult,
} from './return-status-sync.service.interface';

/** Generous by design: a missed transition is an unrefunded buyer. */
const DEFAULT_LOOKBACK_DAYS = 90;

@Injectable()
export class ReturnStatusSyncService implements IReturnStatusSyncService {
  private readonly logger = new Logger(ReturnStatusSyncService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(RETURN_REPOSITORY_TOKEN)
    private readonly repository: ReturnRepositoryPort,
    @Inject(RETURNS_SERVICE_TOKEN)
    private readonly returnsService: IReturnsService
  ) {}

  async sync(
    connectionId: string,
    options: ReturnStatusSyncOptions
  ): Promise<ReturnStatusSyncResult> {
    const reader = await this.resolveReader(connectionId);
    if (!reader) {
      // Same posture as the discovery pass: a connection that cannot read
      // returns is a normal configuration, not a fault to retry.
      return this.emptyResult(false);
    }

    const terminalRawStatuses = reader.terminalRawStatuses ?? [];
    if (terminalRawStatuses.length === 0) {
      this.logger.debug(
        `Connection ${connectionId} declares no terminal return statuses — sweeping on the age bound and page budget alone`
      );
    }

    const filter: ReturnSourceSweepFilter = {
      sourceConnectionId: connectionId,
      origin: 'source_ingested',
      terminalRawStatuses,
      openedSince: this.resolveOpenedSince(options.lookbackDays),
    };

    const total = await this.repository.countForSourceSweep(filter);
    if (total === 0) {
      return { ...this.emptyResult(terminalRawStatuses.length > 0), nextOffset: 0 };
    }

    // A stored offset past the (possibly shrunk) total would page past the end
    // and read nothing, run after run, with no signal — so wrap before reading.
    const offset = (options.offset ?? 0) >= total ? 0 : (options.offset ?? 0);
    const candidates = await this.repository.findForSourceSweep(filter, options.limit, offset);

    let updated = 0;
    let attributed = 0;
    let orphaned = 0;
    let notFound = 0;
    let failed = 0;

    for (const candidate of candidates) {
      try {
        const observation = await reader.getReturn({
          externalReturnId: candidate.externalReturnId,
        });
        const result = await this.returnsService.upsertFromObservation(connectionId, observation);
        updated += 1;
        if (result.attributed) {
          attributed += 1;
        } else {
          orphaned += 1;
        }
      } catch (error) {
        if (this.isNotFound(error)) {
          // The source no longer knows this return. Counted and logged, and the
          // page continues — one withdrawn return must not abort a page of
          // unrelated work, and there is no OL action to take on it.
          notFound += 1;
          this.logger.warn(
            `Return ${candidate.id} (external ${candidate.externalReturnId}) is unknown at the source — counted, page continues (connection: ${connectionId})`
          );
          continue;
        }
        failed += 1;
        this.logger.warn(
          `Failed to re-read return ${candidate.id} (external ${candidate.externalReturnId}) on connection ${connectionId}: ${(error as Error).message}`
        );
      }
    }

    // Advance by rows READ, not rows successfully persisted. Advancing by
    // successes would park the offset on a row that keeps failing and re-read
    // it forever while the rest of the connection's open returns went
    // unchecked; the next full wrap retries it anyway.
    const nextOffset = offset + candidates.length >= total ? 0 : offset + candidates.length;

    return {
      scanned: candidates.length,
      updated,
      attributed,
      orphaned,
      notFound,
      failed,
      total,
      nextOffset,
      terminalVocabularyDeclared: terminalRawStatuses.length > 0,
    };
  }

  /**
   * A 404 from the source, however the adapter's HTTP layer spells it.
   *
   * Structural rather than instance-of, deliberately: every adapter throws its
   * own exception type and core must not learn any of them. `statusCode` is the
   * shape the in-tree HTTP exceptions carry.
   */
  private isNotFound(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }
    const candidate = error as { statusCode?: unknown; status?: unknown };
    return candidate.statusCode === 404 || candidate.status === 404;
  }

  private resolveOpenedSince(lookbackDays?: number): Date {
    const days =
      typeof lookbackDays === 'number' && Number.isFinite(lookbackDays) && lookbackDays > 0
        ? lookbackDays
        : DEFAULT_LOOKBACK_DAYS;
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  /** See `ReturnIngestionService.resolveReader` — same rule, same reasons. */
  private async resolveReader(
    connectionId: string
  ): Promise<(OrderSourcePort & ReturnSourceReader) | null> {
    let adapter: OrderSourcePort;
    try {
      adapter = await this.integrationsService.getCapabilityAdapter<OrderSourcePort>(
        connectionId,
        'OrderSource'
      );
    } catch (error) {
      this.logger.debug(
        `No OrderSource adapter for connection ${connectionId}: ${(error as Error).message}`
      );
      return null;
    }

    if (!isReturnSourceReader(adapter)) {
      this.logger.debug(
        `Connection ${connectionId} has an OrderSource adapter that does not read returns — nothing to sweep`
      );
      return null;
    }

    return adapter;
  }

  private emptyResult(terminalVocabularyDeclared: boolean): ReturnStatusSyncResult {
    return {
      scanned: 0,
      updated: 0,
      attributed: 0,
      orphaned: 0,
      notFound: 0,
      failed: 0,
      total: 0,
      nextOffset: 0,
      terminalVocabularyDeclared,
    };
  }
}
