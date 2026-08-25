/**
 * Return Ingestion Service
 *
 * Core-owned returns ingestion + fan-out orchestration (#2330, ADR-060) — the
 * returns counterpart of `OrderIngestionService`, and modelled on it
 * deliberately rather than incidentally: the cursor-safety rule, the
 * single-flight lock and the deterministic dedupe key are the same three
 * problems, and solving them a second way would mean two things to keep right.
 *
 * ## The one rule this file exists to enforce
 *
 * **The cursor advances only after every enqueue in the page succeeded.**
 * Everything else here is support for that. A source feed cursor is a claim
 * that the items before it have been dealt with; committing one while a child
 * failed to enqueue converts a retryable hiccup into permanent silent data
 * loss, and — because a return is a buyer waiting for money — into an
 * unrefunded buyer nobody will ever be told about. Re-reading a page is free:
 * the downstream write is an idempotent upsert keyed on the source's own return
 * id, so a held cursor costs one duplicate page and loses nothing.
 *
 * ## Why there is no cursor-regression guard
 *
 * `OrderIngestionService` carries an `isCursorRegression` check and this
 * service deliberately does NOT port it. That guard coerces both cursors with
 * `Number()` and falls back to lexicographic comparison — which is defensible
 * for Allegro's numeric-ish event ids and actively harmful here, because a
 * return cursor is a **UUID**. `Number('a3405c27-…')` is `NaN`, `NaN` is not
 * finite, so every comparison would fall through to a lexicographic test over
 * random hex — which refuses roughly half of all legitimate advances, at
 * random, and wedges the connection's cursor the first time it does.
 * `ISyncCursorsService.advanceCursor` states that "monotonicity is the caller's
 * responsibility", and this caller's answer is the honest one available to it:
 * commit only a non-empty cursor, and hold on null or unchanged. That
 * genuinely prevents the two failures a guard can prevent here — a cursor
 * blanked by a degraded source response, and a page reprocessed forever because
 * the source echoed the cursor back — without inventing an ordering UUIDs do
 * not have.
 *
 * @module libs/core/src/returns/application/services
 * @implements {IReturnIngestionService}
 * @see docs/plans/analysis/SPIKE-2289-allegro-returns-feed.md
 */
import { Inject, Injectable } from '@nestjs/common';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { OrderSourcePort, ReturnSourceReader } from '@openlinker/core/orders';
import { isReturnSourceReader } from '@openlinker/core/orders';
import {
  ISyncCursorsService,
  SYNC_CURSORS_SERVICE_TOKEN,
  SyncJobQueuePort,
  SYNC_JOB_QUEUE_TOKEN,
  SyncLockPort,
  SYNC_LOCK_TOKEN,
} from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';
import type { ReturnFeedItem } from '../../domain/types/return-feed.types';
import { RETURNS_SERVICE_TOKEN } from '../../returns.tokens';
import { IReturnsService } from './returns.service.interface';
import type {
  IReturnIngestionService,
  ReturnIngestionOptions,
  ReturnIngestionResult,
  ReturnSyncResult,
} from './return-ingestion.service.interface';

@Injectable()
export class ReturnIngestionService implements IReturnIngestionService {
  private readonly logger = new Logger(ReturnIngestionService.name);

  /** Comfortably above worst-case feed-read + enqueue duration; not refreshed. */
  private readonly LOCK_TTL_MS = 5 * 60_000;

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(SYNC_CURSORS_SERVICE_TOKEN)
    private readonly syncCursors: ISyncCursorsService,
    @Inject(SYNC_JOB_QUEUE_TOKEN)
    private readonly jobQueue: SyncJobQueuePort,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly lock: SyncLockPort,
    @Inject(RETURNS_SERVICE_TOKEN)
    private readonly returnsService: IReturnsService
  ) {}

  async ingestReturns(
    connectionId: string,
    options: ReturnIngestionOptions
  ): Promise<ReturnIngestionResult> {
    const lockKey = `marketplace:returns:poll:${connectionId}`;
    const token = await this.lock.acquire(lockKey, this.LOCK_TTL_MS);
    if (!token) {
      this.logger.debug(`Skipping returns ingestion: lock not acquired (${lockKey})`);
      return this.emptyResult({ skippedDueToLock: true });
    }

    try {
      const reader = await this.resolveReader(connectionId);
      if (!reader) {
        // Not an error, and deliberately not a throw. A connection whose adapter
        // ships no `ReturnSourceReader` is a normal configuration, and the
        // scheduler gates on `OrderSource` (the dispatch vocabulary) rather than
        // on this advertised-without-dispatch sub-capability. Throwing would
        // burn the retry ladder on a condition no retry can change — the #1322
        // lesson.
        return this.emptyResult({ skippedDueToLock: false });
      }

      const { cursorKey, limit } = options;
      const fromCursor = await this.syncCursors.getCursor(connectionId, cursorKey);

      const feed = await reader.listReturnFeed({ fromCursor, limit });

      const usable: ReturnFeedItem[] = [];
      let droppedWithoutId = 0;
      for (const item of feed.items) {
        if (typeof item.externalReturnId === 'string' && item.externalReturnId.trim() !== '') {
          usable.push(item);
          continue;
        }
        // Dropped, counted, and the page still counts as consumed. One
        // malformed item must never hold the cursor for the whole connection —
        // it would never become well-formed on a retry, so holding would wedge
        // ingestion permanently rather than defer it.
        droppedWithoutId += 1;
        this.logger.warn(
          `Return feed item without an external return id dropped (connection: ${connectionId}) — the page is still consumed`
        );
      }

      const requests = usable.map((item) => ({
        type: 'marketplace.return.sync' as const,
        connectionId,
        payload: {
          schemaVersion: 1 as const,
          externalReturnId: item.externalReturnId,
          eventKey: item.eventKey,
          occurredAt: item.occurredAt,
        },
        options: {
          dedupeKey: `marketplace:${connectionId}:return:${item.eventKey}`,
        },
      }));

      // Enqueue FIRST. If this rejects, the cursor is never touched and the
      // whole page is re-read next run. See the class docblock.
      if (requests.length > 0) {
        await this.jobQueue.enqueueBulk(requests);
      }

      const nextCursor = feed.nextCursor;
      const committed = await this.maybeAdvanceCursor(
        connectionId,
        cursorKey,
        fromCursor,
        nextCursor
      );

      return {
        fetched: feed.items.length,
        enqueued: requests.length,
        nextCursor,
        committed,
        skippedDueToLock: false,
        droppedWithoutId,
      };
    } finally {
      await this.lock.release(lockKey, token);
    }
  }

  async syncReturnFromSource(
    connectionId: string,
    externalReturnId: string
  ): Promise<ReturnSyncResult> {
    const reader = await this.resolveReader(connectionId);
    if (!reader) {
      throw new Error(
        `Connection ${connectionId} does not support reading returns from its source`
      );
    }

    const observation = await reader.getReturn({ externalReturnId });
    const { record, attributed } = await this.returnsService.upsertFromObservation(
      connectionId,
      observation
    );

    return { returnId: record.id, attributed };
  }

  /**
   * Commit the cursor, or say honestly why not.
   *
   * Two holds, both of them real failures rather than defensive padding:
   *
   *  - **null / blank.** The contract spells this "no cursor advancement
   *    possible", and a degraded source response is the common way to produce
   *    it. Writing it would blank the connection's cursor and re-ingest its
   *    entire history on the next run.
   *  - **unchanged.** The source echoed back the cursor it was given. Committing
   *    is a no-op, but SAYING it committed would report progress that did not
   *    happen, and an operator watching `committed` to diagnose a stuck feed
   *    would be looking at the wrong signal.
   *
   * Note what is deliberately NOT here: an ordering comparison. See the class
   * docblock on why a regression guard over UUID cursors is worse than none.
   */
  private async maybeAdvanceCursor(
    connectionId: string,
    cursorKey: string,
    fromCursor: string | null,
    nextCursor: string | null
  ): Promise<boolean> {
    if (nextCursor === null || nextCursor.trim() === '') {
      this.logger.debug(
        `Returns feed reported no advanceable cursor; holding ${cursorKey} (connection: ${connectionId})`
      );
      return false;
    }

    if (fromCursor !== null && fromCursor === nextCursor) {
      this.logger.debug(
        `Returns feed cursor unchanged (${nextCursor}); nothing to commit for ${cursorKey} (connection: ${connectionId})`
      );
      return false;
    }

    await this.syncCursors.advanceCursor(connectionId, cursorKey, nextCursor);
    return true;
  }

  /**
   * Resolve the connection's `OrderSource` adapter and narrow it to a
   * `ReturnSourceReader`.
   *
   * `getCapabilityAdapter(connectionId, 'OrderSource')` then the guard — never
   * `getCapabilityAdapter(connectionId, 'ReturnSourceReader')`, which passes the
   * manifest gate and then fails inside `dispatchCapability` with a generic
   * `Error`. Returns `null` on either a failed resolve or a failed narrow, so
   * every caller has one shape to handle.
   */
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
        `Connection ${connectionId} has an OrderSource adapter that does not read returns — nothing to ingest`
      );
      return null;
    }

    return adapter;
  }

  private emptyResult(overrides: Pick<ReturnIngestionResult, 'skippedDueToLock'>): ReturnIngestionResult {
    return {
      fetched: 0,
      enqueued: 0,
      nextCursor: null,
      committed: false,
      droppedWithoutId: 0,
      ...overrides,
    };
  }
}
