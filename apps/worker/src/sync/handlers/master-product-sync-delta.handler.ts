/**
 * Master Product Sync Delta Handler
 *
 * Handles jobs of type 'master.product.syncDelta'. The INCREMENTAL half of the
 * catalog pass (#2220, ADR-048 decisions 1/3): it enumerates only the products a
 * master reports as changed since a stored watermark, and fans out the same
 * per-product 'master.product.syncByExternalId' children the full sweep does.
 *
 * It is additive, not a replacement. `master.product.syncAll` keeps running on its
 * own cadence and remains the bootstrap and reconciliation path; only that pass may
 * ever conclude a product DISAPPEARED (ADR-048 decision 2 — a modified-since query
 * cannot observe a deletion, the record simply stops appearing). This handler must
 * therefore never grow a catalog-level prune. A spec pins that it enqueues nothing
 * but `master.product.syncByExternalId`.
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
 *   set stays stable across a multi-tick cycle.
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
import type { ModifiedProductLister } from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import {
  formatSweepCursor,
  parseSweepCursor,
  resolveSweepBudget,
  resolveSweepLockTtlMs,
  runBoundedSweep,
  sweepCursorKey,
  sweepLockKey,
} from '../bounded-sweep';
import type { SweepPage } from '../bounded-sweep.types';

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
        this.logger.log(
          `master.product.syncDelta skipped for connection ${job.connectionId}: ` +
            `its ProductMaster adapter does not implement the modified-since rung`
        );
        return { outcome: 'ok' };
      }

      // Captured BEFORE the read, never derived from the previous run's end time.
      const capturedAt = new Date();
      const watermarkKey = this.watermarkKey(job.connectionId);
      const storedWatermark = await this.cursors.getCursor(job.connectionId, watermarkKey);
      const previous = this.parseWatermark(storedWatermark);

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

      this.warnIfWatermarkStale(job.connectionId, previous, capturedAt);

      const since = new Date(previous.getTime() - this.getLookbackSeconds(payload) * 1000);
      const cursorKey = sweepCursorKey('product-delta', job.connectionId);
      const cursor = parseSweepCursor(await this.cursors.getCursor(job.connectionId, cursorKey));

      const result = await runBoundedSweep({
        cursor,
        budget,
        readPage: (offset, pageBudget) => this.readPage(productMaster, since, offset, pageBudget),
        enqueue: (externalId, cycleId) => this.enqueueChild(job, externalId, cycleId),
        newCycleId: () => randomUUID(),
      });

      await this.cursors.advanceCursor(
        job.connectionId,
        cursorKey,
        result.nextCursor === null ? '' : formatSweepCursor(result.nextCursor)
      );

      // Only a completed cycle may move the watermark. A budget-truncated or
      // partly-failed run leaves it, so the next tick recomputes the SAME `since`
      // and the un-enqueued tail is still in the query set.
      if (result.completed && result.failed === 0) {
        await this.cursors.advanceCursor(job.connectionId, watermarkKey, capturedAt.toISOString());
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
                ? `cycle complete, watermark advanced to ${capturedAt.toISOString()}`
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

  /**
   * Reads up to `budget` external ids, paging the master at its own page size.
   *
   * Mirrors the full sweep's loop exactly — including truncating at a PAGE
   * boundary — which is also what keeps `offset` a multiple of the page size so the
   * WooCommerce offset-to-page derivation stays exact.
   */
  private async readPage(
    lister: ModifiedProductLister,
    since: Date,
    offset: number,
    budget: number
  ): Promise<SweepPage> {
    const pageSize = this.getPageSize();
    const collected: string[] = [];
    let exhausted = false;
    let consumed = 0;

    while (collected.length < budget) {
      const batch = await lister.listExternalIdsModifiedSince({
        since,
        limit: pageSize,
        offset: offset + consumed,
      });
      if (batch.length === 0) {
        exhausted = true;
        break;
      }
      collected.push(...batch);
      consumed += batch.length;
      if (batch.length < pageSize) {
        exhausted = true;
        break;
      }
    }

    return { items: [...new Set(collected)], consumed, exhausted };
  }

  private async enqueueChild(job: SyncJob, externalId: string, cycleId: string): Promise<unknown> {
    const jobRequest: SyncJobRequest = {
      jobType: 'master.product.syncByExternalId',
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

  private watermarkKey(connectionId: string): string {
    return `master.product-delta.watermark:connection:${connectionId}`;
  }

  private parseWatermark(raw: string | null): Date | null {
    if (raw === null || raw.trim() === '') {
      return null;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      // Defensive, matching `parseSweepCursor`: a malformed value restarts the
      // watermark rather than wedging the sweep forever.
      this.logger.warn(
        `Unparseable delta watermark "${raw}" — treating as absent and re-stamping.`
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
    const raw =
      typeof payload.lookbackSeconds === 'number'
        ? payload.lookbackSeconds
        : Number(
            this.configService.get<string>(
              'OL_MASTER_DELTA_LOOKBACK_SECONDS',
              String(LOOKBACK_SECONDS_DEFAULT)
            )
          );
    if (!Number.isFinite(raw) || raw < 0) {
      return LOOKBACK_SECONDS_DEFAULT;
    }
    return Math.min(Math.floor(raw), LOOKBACK_SECONDS_MAX);
  }

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
