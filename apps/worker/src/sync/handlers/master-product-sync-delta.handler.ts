/**
 * Master Product Sync Delta Handler
 *
 * Handles jobs of type 'master.product.syncDelta'. The INCREMENTAL half of the
 * catalog pass (#2220, ADR-048 decisions 1/3): it enumerates only the products a
 * master reports as changed since a stored watermark, and fans out the same
 * per-product 'master.product.syncFromSweep' children the full sweep does.
 *
 * It is additive, not a replacement. `master.product.syncAll` keeps running on its
 * own cadence and remains the bootstrap and reconciliation path; only that pass may
 * ever conclude a product DISAPPEARED (ADR-048 decision 2 — a modified-since query
 * cannot observe a deletion, the record simply stops appearing). This handler must
 * therefore never grow a catalog-level prune. A spec pins that it enqueues nothing
 * but `master.product.syncFromSweep`.
 *
 * What it does NOT skip is the per-product variant prune. `markVariantsStaleExcept`
 * runs inside `syncByExternalId` against the variants of the one product the master
 * just returned, is authoritative there, and is inherited unchanged on this path —
 * as is `handleMasterDeletion`, which fires correctly when a product is deleted
 * between enumeration and child execution (a per-product 404 IS authoritative).
 * "Delta cannot observe deletions" is a statement about the enumeration, not about
 * the path. Two prunes, two authorities (ADR-048 decision 2 para 2).
 *
 * Three properties are deliberate:
 *
 * - **Its own lock, so it can run beside the full sweep.** Sharing the `product`
 *   lock would let the full sweep — mid-cycle more or less permanently on a large
 *   catalog, by #2218's design — starve this pass indefinitely while it logged
 *   "already in progress" and returned ok: the delta path looking healthy while
 *   being wrong, which is exactly what ADR-048 warns about. The accepted cost is
 *   that a product in both passes is enqueued twice under two cycle ids. That is
 *   bounded, self-limiting, and harmless because the child is idempotent. Do not
 *   "fix" it by sharing a lock.
 * - **The watermark advances only when the cycle completes**, so `since` is
 *   recomputed from the unadvanced watermark on every resuming tick and the query
 *   set stays stable across a multi-tick cycle. It advances to the instant the
 *   CYCLE opened, not to the completing tick's clock — a multi-tick cycle queries
 *   one fixed `since`, so stamping the last tick's clock would move the watermark
 *   past rows the cycle never had the chance to observe.
 * - **A missing watermark stamps and enumerates nothing.** Treating it as "since
 *   the epoch" would make the first delta tick a second full pass. The full sweep
 *   is what bootstraps a catalog.
 *
 * @module apps/worker/src/sync/handlers
 * @see {@link runBoundedSweep} for the shared budget/cursor shape
 */

import { randomUUID } from 'node:crypto';
import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  SyncJobRequest,
  MasterProductSyncDeltaPayloadV1,
} from '@openlinker/core/sync';
import {
  SyncJobExecutionError,
  JobEnqueuePort,
  JOB_ENQUEUE_TOKEN,
  SYNC_CURSORS_SERVICE_TOKEN,
  SYNC_LOCK_TOKEN,
  ISyncCursorsService,
  SyncLockPort,
} from '@openlinker/core/sync';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { ProductMasterPort } from '@openlinker/core/products';
import { isModifiedProductLister } from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import {
  formatSweepCursor,
  parseSweepCursor,
  readPagedIds,
  resolveSweepBudget,
  resolveSweepLockTtlMs,
  runBoundedSweep,
  sweepCursorKey,
  sweepLockKey,
} from '../bounded-sweep';

type SyncJob = SyncJobEntity;

/** WooCommerce rejects `per_page` above 100 with a 400 (#1723). */
const DEFAULT_PAGE_SIZE = 100;

/**
 * Overlaps the change window backwards so a row whose timestamp precedes its commit
 * is re-read rather than skipped (ADR-048 decision 3 — never `since = lastRunAt`).
 * Re-reading is free ONLY because every downstream write is idempotent:
 * `syncByExternalId` upserts, and the child idempotency key is cycle-scoped.
 */
const LOOKBACK_SECONDS_DEFAULT = 300;
const LOOKBACK_SECONDS_MAX = 86_400;

/**
 * A cycle that never completes never advances the watermark, so the delta pass
 * silently degenerates into a permanent full pass while every job row reads ok.
 * The watermark's age is the only cheap observable for it.
 */
const STALE_WATERMARK_WARN_HOURS_DEFAULT = 24;

@Injectable()
export class MasterProductSyncDeltaHandler implements SyncJobHandler {
  private readonly logger = new Logger(MasterProductSyncDeltaHandler.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
    @Inject(SYNC_CURSORS_SERVICE_TOKEN)
    private readonly cursors: ISyncCursorsService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    private readonly configService: ConfigService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);
    const budget = resolveSweepBudget(payload.pageLimit);
    const lockKey = sweepLockKey('product-delta', job.connectionId);
    const lockTtlMs = resolveSweepLockTtlMs(
      this.configService.get<string>('OL_MASTER_SWEEP_LOCK_TTL_MS')
    );

    const lockToken = await this.syncLock.acquire(lockKey, lockTtlMs);
    if (lockToken === null) {
      this.logger.log(
        `master.product.syncDelta skipped for connection ${job.connectionId}: ${lockKey} already in progress`
      );
      return { outcome: 'ok' };
    }

    try {
      const productMaster = await this.integrationsService.getCapabilityAdapter<ProductMasterPort>(
        job.connectionId,
        'ProductMaster'
      );

      // Guard-only rung: narrowed off the dispatched ProductMaster adapter, never
      // resolved through getCapabilityAdapter (see the capability file's header).
      // A master that does not offer it is not an error — it stays enumerate-only.
      if (!isModifiedProductLister(productMaster)) {
        // `debug`, not `log`: this is a permanent structural property of the
        // adapter, not an event. The task is gated on `ProductMaster` (see the
        // scheduler descriptor for why it cannot be gated on the rung itself), so
        // every non-declaring connection reaches this line on every tick — at
        // `log` level that is a steady stream of noise describing nothing new.
        this.logger.debug(
          `master.product.syncDelta skipped for connection ${job.connectionId}: ` +
            `its ProductMaster adapter does not implement the modified-since rung`
        );
        return { outcome: 'ok' };
      }

      // Captured BEFORE the read, never derived from the previous run's end time.
      const capturedAt = new Date();
      const watermarkKey = this.watermarkKey(job.connectionId);
      const storedWatermark = await this.cursors.getCursor(job.connectionId, watermarkKey);
      const previous = this.parseWatermark(storedWatermark, 'watermark');

      if (previous === null) {
        // First run (or a lost/cleared watermark — the two are indistinguishable,
        // which is why this is `warn`: a second occurrence means a real gap was
        // swallowed). Stamp and enumerate nothing; no cycle is opened.
        await this.cursors.advanceCursor(job.connectionId, watermarkKey, capturedAt.toISOString());
        this.logger.warn(
          `master.product.syncDelta for connection ${job.connectionId}: no stored watermark, ` +
            `stamping ${capturedAt.toISOString()} and enumerating nothing. The full sweep bootstraps the catalog; ` +
            `if this repeats, a watermark is being lost and the gap between stamps went unsynced by this pass.`
        );
        return { outcome: 'ok' };
      }

      const since = new Date(previous.getTime() - this.getLookbackSeconds(payload) * 1000);
      const cursorKey = sweepCursorKey('product-delta', job.connectionId);
      const cursor = parseSweepCursor(await this.cursors.getCursor(job.connectionId, cursorKey));

      // Only meaningful when NO cycle is open. A resuming tick holds the watermark
      // BY DESIGN, so on a catalog large enough to span more than the threshold in
      // ticks, warning here would have the cursor-resumption design reporting its
      // own correct behaviour as a fault — and a warning that fires when nothing is
      // wrong is how a real one stops being read. The cycle-in-flight state already
      // distinguishes the two, so the warn is for a watermark that is old with
      // nothing in flight to explain it.
      if (cursor === null) {
        this.warnIfWatermarkStale(job.connectionId, previous, capturedAt);
      }

      // The instant the watermark will advance to belongs to the CYCLE, not to the
      // tick that happens to finish it. A multi-tick cycle queries one fixed
      // `since`, so stamping the completing tick's clock would advance the
      // watermark past rows the cycle never had a chance to observe — and the one
      // row shape the ADR-048 #2220 amendment already concedes can be stepped over
      // (re-modified mid-cycle, shifted left past the offset cursor) would go from
      // "missed for one cycle" to "missed permanently, only the full sweep finds
      // it". So it is captured when the cycle OPENS and carried across resumptions.
      //
      // Reading it is deliberately INSIDE the `cursor !== null` branch. A pending
      // value can outlive its cycle (a crash between the cursor clear and the
      // pending clear), and it is only meaningful while a cursor exists — reading
      // it unconditionally would stamp a dead cycle's instant and move the
      // watermark BACKWARDS, re-reading an ever-growing window while every job row
      // read ok. Opening a new cycle always overwrites it, which is what makes a
      // stale value self-healing. A spec pins this; do not hoist the read.
      //
      // The `?? capturedAt` fallback is the deploy transition: a cycle already in
      // flight when this shipped has no pending value, so that one cycle keeps the
      // old (completing-tick) behaviour and its one-cycle exposure. It self-corrects
      // on the next cycle, and falling forward is the safe direction.
      const pendingKey = this.pendingWatermarkKey(job.connectionId);
      const cycleStartedAt =
        cursor === null
          ? capturedAt
          : (this.parseWatermark(
              await this.cursors.getCursor(job.connectionId, pendingKey),
              'pending cycle-start'
            ) ??
            capturedAt);
      if (cursor === null) {
        await this.cursors.advanceCursor(
          job.connectionId,
          pendingKey,
          cycleStartedAt.toISOString()
        );
      }

      const result = await runBoundedSweep({
        cursor,
        budget,
        readPage: (offset, pageBudget) =>
          readPagedIds(
            (pageOffset, limit) =>
              productMaster.listExternalIdsModifiedSince({ since, limit, offset: pageOffset }),
            offset,
            pageBudget,
            this.getPageSize()
          ),
        // One id per child: this sweep keeps the per-item fan-out.
        enqueue: (externalIds, cycleId) => this.enqueueChild(job, externalIds[0], cycleId),
        newCycleId: () => randomUUID(),
      });

      // ORDER MATTERS — these two writes are not atomic, and this is the safe
      // order. A crash between them leaves the cursor cleared and the watermark
      // held, so the next tick restarts the cycle against the same `since`:
      // duplicated children under a fresh cycle id, which is idempotent-safe.
      // Swapping them silently SKIPS rows — the watermark would advance while the
      // cursor still pointed at an offset, and the next tick would resume at that
      // offset against a newer, smaller query set. Do not reorder.
      await this.cursors.advanceCursor(
        job.connectionId,
        cursorKey,
        result.nextCursor === null ? '' : formatSweepCursor(result.nextCursor)
      );

      // Only a completed cycle may move the watermark. A budget-truncated or
      // partly-failed run leaves it, so the next tick recomputes the SAME `since`
      // and the un-enqueued tail is still in the query set.
      //
      // `failed === 0` is belt-and-braces: `runBoundedSweep` currently hard-codes
      // `completed: false` on its failure branch, so the term is redundant today
      // and no test can distinguish it. It is kept deliberately — this is the
      // write that must never run early, and a future edit to the sweep's failure
      // handling should not be able to reach it by accident.
      if (result.completed && result.failed === 0) {
        await this.cursors.advanceCursor(
          job.connectionId,
          watermarkKey,
          cycleStartedAt.toISOString()
        );
        // Cleared last: the pending value is only meaningful while a cycle is open.
        await this.cursors.advanceCursor(job.connectionId, pendingKey, '');
      }

      if (result.failed > 0) {
        this.logger.error(
          `master.product.syncDelta for connection ${job.connectionId}: ${result.enqueued} enqueued, ` +
            `${result.failed} failed; watermark held at ${previous.toISOString()} and cursor held at offset ` +
            `${String(result.nextCursor?.offset ?? 0)} so the page retries next tick`
        );
      } else {
        this.logger.log(
          `master.product.syncDelta for connection ${job.connectionId}: ${result.enqueued} product sync job(s) ` +
            `enqueued for changes since ${since.toISOString()} (cycle ${result.cycleId}, ` +
            `${
              result.completed
                ? // `cycleStartedAt`, never `capturedAt` — on a multi-tick cycle those
                  // differ by the whole span of the cycle, and this line must report
                  // the value actually persisted or an operator reconstructing a
                  // suspected skip window is handed the wrong one.
                  `cycle complete, watermark advanced to ${cycleStartedAt.toISOString()}`
                : `resuming at offset ${String(result.nextCursor?.offset ?? 0)}, watermark held`
            })`
        );
      }

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `master.product.syncDelta failed: ${message}`,
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
          `Failed to release ${lockKey}: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`
        );
      }
    }
  }

  private async enqueueChild(job: SyncJob, externalId: string, cycleId: string): Promise<unknown> {
    const jobRequest: SyncJobRequest = {
      // Sweep-triggered child: same handler and payload as the
      // webhook-driven `master.product.syncByExternalId`, distinct type so
      // ADR-050 can lane it by its own cost of starvation (#2594).
      jobType: 'master.product.syncFromSweep',
      connectionId: job.connectionId,
      payload: {
        schemaVersion: 1,
        externalId,
        objectType: CORE_ENTITY_TYPE.Product,
      },
      // Cycle-scoped, and in a namespace distinct from the full sweep's. The two
      // passes therefore do NOT dedup against each other — see the header: that
      // duplication is the accepted price of not sharing a lock.
      idempotencyKey: `master:${job.connectionId}:product:syncDelta:${externalId}:${cycleId}`,
    };
    return this.jobEnqueue.enqueueJob(jobRequest);
  }

  /**
   * Holds the cycle's opening instant while a cycle is in flight, so a resuming
   * tick advances the watermark to when the cycle STARTED rather than to its own
   * clock. Empty/absent means no cycle is open.
   */
  private pendingWatermarkKey(connectionId: string): string {
    return `master.product-delta.pending-watermark:connection:${connectionId}`;
  }

  private watermarkKey(connectionId: string): string {
    return `master.product-delta.watermark:connection:${connectionId}`;
  }

  private parseWatermark(raw: string | null, label: string): Date | null {
    if (raw === null || raw.trim() === '') {
      return null;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      // Defensive, matching `parseSweepCursor`: a malformed value restarts the
      // watermark rather than wedging the sweep forever.
      this.logger.warn(
        `Unparseable ${label} value "${raw}" for the delta pass — treating as absent.`
      );
      return null;
    }
    return parsed;
  }

  private warnIfWatermarkStale(connectionId: string, previous: Date, now: Date): void {
    const ageHours = (now.getTime() - previous.getTime()) / 3_600_000;
    const threshold = this.getStaleWarnHours();
    if (ageHours > threshold) {
      this.logger.warn(
        `master.product.syncDelta for connection ${connectionId}: watermark is ${ageHours.toFixed(1)}h old ` +
          `(threshold ${String(threshold)}h). A cycle that never completes never advances the watermark, so this ` +
          `pass may be re-reading an ever-growing window — check whether the budget can drain the change set.`
      );
    }
  }

  private getLookbackSeconds(payload: MasterProductSyncDeltaPayloadV1): number {
    const configured = this.configService.get<string>(
      'OL_MASTER_DELTA_LOOKBACK_SECONDS',
      String(LOOKBACK_SECONDS_DEFAULT)
    );
    const fromPayload = typeof payload.lookbackSeconds === 'number';
    const raw = fromPayload ? (payload.lookbackSeconds as number) : Number(configured);

    // `0` is rejected along with negatives and non-finites, not accepted as "no
    // overlap": `since === watermark` is precisely the `modified_since =
    // last_run_time` shape ADR-048 decision 3 forbids, and the overlap is what
    // makes a row whose timestamp precedes its commit recoverable. An operator
    // may tune the window; they may not switch the invariant off through it.
    if (!Number.isFinite(raw) || raw <= 0) {
      // Warned, not silent: an operator who deliberately set 0 (or a bad value)
      // would otherwise get a window they did not choose, with no signal that
      // their configuration was overridden. The message quotes what they actually
      // configured — `String(raw)` would print "NaN" for a typo like `abc` and
      // send them looking for the wrong thing.
      const offending = fromPayload ? String(payload.lookbackSeconds) : configured;
      this.logger.warn(
        `Rejected delta lookback "${offending}" from ${
          fromPayload ? 'the job payload' : 'OL_MASTER_DELTA_LOOKBACK_SECONDS'
        } (must be > 0 — a zero overlap is the \`since = lastRunAt\` shape ADR-048 ` +
          `decision 3 forbids); using ${String(LOOKBACK_SECONDS_DEFAULT)}s.`
      );
      return LOOKBACK_SECONDS_DEFAULT;
    }
    return Math.min(Math.floor(raw), LOOKBACK_SECONDS_MAX);
  }

  /**
   * Silently defaults on a bad value, unlike `getLookbackSeconds`. The asymmetry is
   * deliberate rather than an oversight: the lookback is the one knob that can
   * disable an ADR-048 decision-3 invariant, so an override of it that OL refuses
   * has to be visible. These two only tune noise thresholds and page size — a
   * rejected value costs the operator nothing they would act on, and warning on
   * every tick for it is the kind of noise that trains people to ignore warnings.
   */
  private getStaleWarnHours(): number {
    const parsed = Number(
      this.configService.get<string>(
        'OL_MASTER_DELTA_STALE_WARN_HOURS',
        String(STALE_WATERMARK_WARN_HOURS_DEFAULT)
      )
    );
    return Number.isFinite(parsed) && parsed > 0 ? parsed : STALE_WATERMARK_WARN_HOURS_DEFAULT;
  }

  /** Defaults rather than throwing on a malformed payload — see the full sweep's handler. */
  private getPayload(job: SyncJob): MasterProductSyncDeltaPayloadV1 {
    const payload = job.payload as unknown as Partial<MasterProductSyncDeltaPayloadV1> | null;
    return {
      schemaVersion: 1,
      pageLimit: payload && typeof payload.pageLimit === 'number' ? payload.pageLimit : undefined,
      lookbackSeconds:
        payload && typeof payload.lookbackSeconds === 'number'
          ? payload.lookbackSeconds
          : undefined,
    };
  }

  private getPageSize(): number {
    const raw = this.configService.get<string>(
      'OL_PRODUCT_SYNC_PAGE_SIZE',
      String(DEFAULT_PAGE_SIZE)
    );
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PAGE_SIZE;
  }
}
