/**
 * Inventory Provenance Backfill Handler
 *
 * Handles jobs of type `inventory.provenance.backfill` — ADR-058 ladder step
 * (ii) (#2317). Step (i) (#2314) added `inventory_items.sourceConnectionId` as
 * a nullable column; step (iii) (#2325) makes it `NOT NULL` and folds it into
 * the position key. This is the pass in between: stamp every pre-existing row
 * with the `'legacy'` sentinel, a bounded page at a time, until none remain.
 *
 * ## Why this does not call `runBoundedSweep`
 *
 * The issue sketched this "over the existing `runBoundedSweep` shape", and the
 * *properties* that sentence is after — budgeted, per-run locked, resumable, a
 * cursor that never advances past unfinished work, self-terminating, with a
 * completion report — are all delivered here. What is not reused is the
 * SCAN-OFFSET MECHANISM, and `bounded-sweep.ts` draws that exact distinction in
 * its own header: the sweep family pages by `{limit, offset}` because its
 * source (a master's catalog, OL's own mappings) is a stable set that a run
 * reads through, whereas taxonomy uses frontier-as-query because its remaining
 * work is re-derivable from a predicate.
 *
 * This pass is unambiguously the second kind, and using the first would be a
 * correctness bug rather than a stylistic mismatch. Its work is selected by
 * `sourceConnectionId IS NULL`, and every page CONSUMES its own selection —
 * stamped rows leave the candidate set. An offset advancing over a shrinking
 * set steps over rows that were never stamped, silently, and the only place
 * that surfaces is #2325's `SET NOT NULL` failing months later. Keeping a
 * permanently-zero offset on a cursor purely to satisfy the shape would be the
 * same design wearing a misleading costume.
 *
 * So the sweep PRIMITIVES are reused (`resolveSweepBudget`,
 * `resolveSweepLockTtlMs`, `sweepLockKey`, and the two persisted cursor keys)
 * and the offset machinery is not. `MarketplaceOrderFxStampSweepHandler` is the
 * behavioural precedent for a predicate-driven bounded pass in this tree.
 *
 * ## The latch, and why the cron keeps ticking
 *
 * There is no one-shot job mechanism in this repo, and building one would not
 * survive contact with `SchedulerLeaseCoordinator`: an in-process
 * deregistration is undone the moment the lease moves to another replica. So
 * the task stays registered and the handler self-latches — it reads the
 * completion stamp FIRST, before taking the lock or touching the table, and
 * returns immediately once set. Steady-state cost after the drain is one cursor
 * read per tick.
 *
 * Deleting that cursor row re-arms the pass. That is a deliberate escape hatch
 * rather than an accident: the predicate is `IS NULL`, so a re-run over a
 * stamped table is a no-op, and an operator who needs to re-drain (a restore
 * from an old dump) has a supported way to ask.
 *
 * ## Global scope
 *
 * `sourceConnectionId IS NULL` has no connection axis — that absence is what
 * the pass exists to repair — so it runs once for the whole deployment under
 * the nil-UUID `SYSTEM_CONNECTION_ID` (precedents: `InventoryService`, and
 * `apps/worker/src/events/master-deletion-to-job.handler.ts`). Electing a real
 * connection was rejected: the installs with the most NULL rows are exactly the
 * ones whose original connection was deleted, and a changing election would
 * move the latch and re-run a finished drain.
 *
 * @module apps/worker/src/sync/handlers
 * @see {@link IInventoryProvenanceBackfillService} for the completion predicate
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  InventoryProvenanceBackfillPayloadV1,
} from '@openlinker/core/sync';
import {
  SyncJobExecutionError,
  SYNC_CURSORS_SERVICE_TOKEN,
  SYNC_LOCK_TOKEN,
  ISyncCursorsService,
  SyncLockPort,
} from '@openlinker/core/sync';
import { IInventoryProvenanceBackfillService } from '@openlinker/core/inventory';
import { INVENTORY_PROVENANCE_BACKFILL_SERVICE_TOKEN } from '@openlinker/core/inventory';
import { Logger } from '@openlinker/shared/logging';
import {
  resolveSweepBudget,
  resolveSweepLockTtlMs,
  sweepCompletedAtCursorKey,
  sweepLockKey,
  sweepRemainingCountCursorKey,
} from '../bounded-sweep';

type SyncJob = SyncJobEntity;

/**
 * The nil UUID standing in for "the whole deployment, no particular
 * connection". Declared locally rather than imported because the two existing
 * users declare it locally too — see the header, and
 * `apps/worker/src/events/master-deletion-to-job.handler.ts:56`. Neither
 * `sync_jobs.connectionId` nor `connection_cursors` carries an FK to
 * `connections`, which is what makes the value usable at all.
 */
const SYSTEM_CONNECTION_ID = '00000000-0000-0000-0000-000000000000';

/** The sweep-key namespace this pass owns. */
const BACKFILL_SWEEP_KIND = 'inventory-provenance';

/**
 * Rows stamped per run.
 *
 * Deliberately NOT `resolveSweepBudget`'s own default of 100. That number is
 * derived, in `bounded-sweep.ts`, from the drain rate of a CHILD JOB performing
 * a full per-product platform sync (~2-5 s each) against an execution
 * concurrency of 1 — arithmetic that does not transfer here, because this pass
 * enqueues no children and makes no platform calls. One unit of work is one row
 * in a single bounded UPDATE against local Postgres, so the whole page costs
 * low milliseconds and the binding constraint is lock footprint rather than
 * tick duration.
 *
 * 500 is `SWEEP_BUDGET_MAX`, so the resolver's ceiling still applies and a
 * payload cannot widen it — a page big enough to matter for lock hold time is
 * unreachable by configuration. At this budget and the default 5-minute cron a
 * 100k-row table drains in roughly 17 hours; an operator in a hurry shortens
 * the cron rather than raising the page.
 */
const INVENTORY_PROVENANCE_PAGE_LIMIT_DEFAULT = 500;

@Injectable()
export class InventoryProvenanceBackfillHandler implements SyncJobHandler {
  private readonly logger = new Logger(InventoryProvenanceBackfillHandler.name);

  constructor(
    @Inject(INVENTORY_PROVENANCE_BACKFILL_SERVICE_TOKEN)
    private readonly backfill: IInventoryProvenanceBackfillService,
    @Inject(SYNC_CURSORS_SERVICE_TOKEN)
    private readonly cursors: ISyncCursorsService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    private readonly configService: ConfigService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const scopeId = job.connectionId;
    const completedAtKey = sweepCompletedAtCursorKey(BACKFILL_SWEEP_KIND, scopeId);

    // The latch, read BEFORE the lock and before any table access: once the
    // drain is done this is the entire cost of a tick.
    const completedAt = await this.cursors.getCursor(scopeId, completedAtKey);
    if (completedAt !== null && completedAt.length > 0) {
      this.logger.debug(
        `inventory.provenance.backfill already completed at ${completedAt}; nothing to do`
      );
      return { outcome: 'ok' };
    }

    const budget = resolveSweepBudget(
      this.getPayload(job).pageLimit ?? INVENTORY_PROVENANCE_PAGE_LIMIT_DEFAULT
    );
    const lockKey = sweepLockKey(BACKFILL_SWEEP_KIND, scopeId);
    const lockTtlMs = resolveSweepLockTtlMs(
      this.configService.get<string>('OL_MASTER_SWEEP_LOCK_TTL_MS')
    );

    const lockToken = await this.syncLock.acquire(lockKey, lockTtlMs);
    if (lockToken === null) {
      this.logger.log(
        `inventory.provenance.backfill skipped: ${lockKey} already in progress`
      );
      return { outcome: 'ok' };
    }

    try {
      const result = await this.backfill.runPage(budget);

      // Both stamps are best-effort and never thrown (#2242's posture). The
      // page's own write already committed, so failing the job here would
      // re-run a page that is done — harmless, since the predicate is
      // self-consuming, but it would also retry a job whose work succeeded.
      // Both values self-heal on the next tick: the count is re-taken every
      // run, and the completion stamp is re-attempted while the latch is unset.
      await this.stampCursor(
        scopeId,
        sweepRemainingCountCursorKey(BACKFILL_SWEEP_KIND, scopeId),
        String(result.remainingNull),
        'remaining-count'
      );

      if (result.completed) {
        // Written AFTER the count, so a crash between the two leaves the latch
        // unset and the pass re-runs one no-op page — the safe direction.
        // Stamping completion first could latch the sweep off while the
        // readiness number #2325 reads was never written.
        await this.stampCursor(
          scopeId,
          completedAtKey,
          new Date().toISOString(),
          'completion'
        );
        this.logger.log(
          `inventory.provenance.backfill complete: stamped ${String(result.stamped)} row(s) on the ` +
            `final page, 0 rows remain without provenance (#2325 may proceed)`
        );
      } else {
        this.logger.log(
          `inventory.provenance.backfill: stamped ${String(result.stamped)} row(s), ` +
            `${String(result.remainingNull)} still without provenance`
        );
      }

      return { outcome: 'ok' };
    } catch (error) {
      // Nothing was persisted on this path — not the count, not the latch — so
      // a failed page leaves the pass exactly where it was and the next tick
      // retries it. That is this design's answer to "the cursor must not
      // advance on a failed page": there is no cursor to hold.
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `inventory.provenance.backfill failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    } finally {
      try {
        await this.syncLock.release(lockKey, lockToken);
      } catch (releaseError) {
        this.logger.warn(
          `Failed to release ${lockKey}: ${
            releaseError instanceof Error ? releaseError.message : String(releaseError)
          }`
        );
      }
    }
  }

  private async stampCursor(
    scopeId: string,
    key: string,
    value: string,
    label: string
  ): Promise<void> {
    try {
      await this.cursors.advanceCursor(scopeId, key, value);
    } catch (error) {
      this.logger.warn(
        `Failed to stamp inventory provenance backfill ${label} cursor: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Throws on a malformed payload rather than defaulting (the fx-stamp sweep's
   * shape, not the reconcile handler's). The scheduler is the only producer of
   * this payload, so anything else arriving is a defect that should be loud;
   * `pageLimit` is clamped WITHIN a well-formed envelope, which is a different
   * question — an out-of-range bound is an operator's configuration, not a bug.
   */
  private getPayload(job: SyncJob): InventoryProvenanceBackfillPayloadV1 {
    const payload = job.payload as Partial<InventoryProvenanceBackfillPayloadV1> | undefined | null;

    if (payload === null || typeof payload !== 'object' || payload.schemaVersion !== 1) {
      throw new SyncJobExecutionError(
        `Invalid inventory.provenance.backfill payload: expected an object with schemaVersion=1`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }

    return {
      schemaVersion: 1,
      pageLimit: typeof payload.pageLimit === 'number' ? payload.pageLimit : undefined,
    };
  }
}

/** Exported for the scheduler + specs; see the constant's own docblock. */
export {
  INVENTORY_PROVENANCE_PAGE_LIMIT_DEFAULT,
  SYSTEM_CONNECTION_ID as INVENTORY_PROVENANCE_SCOPE_ID,
  BACKFILL_SWEEP_KIND as INVENTORY_PROVENANCE_SWEEP_KIND,
};
