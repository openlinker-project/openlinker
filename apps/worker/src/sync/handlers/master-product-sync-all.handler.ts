/**
 * Master Product Sync All Handler
 *
 * Handles jobs of type 'master.product.syncAll'. Enumerates external product IDs
 * from the source platform via ProductMasterPort.listExternalIds and fans out
 * 'master.product.syncBatch' sub-jobs, each covering a page of products (#2593 -
 * it used to fan out one 'master.product.syncByExternalId' per product, which
 * built a fresh adapter instance per product and so could never share a bulk
 * read). This is the catalog
 * discovery path — the mechanism by which OpenLinker learns about products that
 * exist on a freshly connected source platform but have no identifier mapping yet.
 *
 * BOUNDED AND RESUMABLE since #2218 (ADR-048 decisions 4-6). Each run enqueues at
 * most `budget` children, records where it stopped on a connection cursor, and the
 * next cron tick resumes; runs are serialised per connection by a lock. It used to
 * page the entire catalog and `map(...)` one child per product with no cap, every
 * 20 minutes, into a runner whose execution concurrency is 1.
 *
 * Two properties are deliberate and easy to get wrong on a later edit:
 *
 * - **A budgeted run is the healthy steady state, not an incident**, so it returns
 *   a plain `outcome: 'ok'` like every other sweep (`fxStampSweep`, taxonomy,
 *   offer-status). The cursor — non-empty means a cycle is in flight — is the
 *   observable, not `sync_jobs`. #2218's acceptance criterion asked for the
 *   distinction to live in `sync_jobs`; that was declined because
 *   `JobOutcomeReasonValues` is FE-mirrored and adding a value would put an
 *   attention-shaped label on normal operation.
 * - **Nothing throws on a bound.** The old `MAX_PAGES` guard warned
 *   "pagination may be truncated" and then returned `{ outcome: 'ok' }` — a
 *   silently half-replicated catalog reporting healthy. It is gone: a run that hits
 *   its budget resumes rather than truncates. Throwing instead would cost
 *   `maxAttempts=10` with backoff to 6 h and one accumulating dead row per tick,
 *   while the catalog stays unreplicated (ADR-048 decision 5).
 *
 * @module apps/worker/src/sync/handlers
 * @see {@link runBoundedSweep} for the shared shape, also used by the inventory sweep
 */

import { randomUUID } from 'node:crypto';
import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  SyncJobRequest,
  MasterProductSyncAllPayloadV1
} from '@openlinker/core/sync';
import {
  SyncJobExecutionError,
  JobEnqueuePort,
  JOB_ENQUEUE_TOKEN,
  SYNC_CURSORS_SERVICE_TOKEN,
  SYNC_LOCK_TOKEN,

  ISyncCursorsService,
  SyncLockPort} from '@openlinker/core/sync';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import {
  OPERATIONAL_SETTINGS_SERVICE_TOKEN,
  type IOperationalSettingsService,
  type OperationalSettingsView,
} from '@openlinker/core/operational-settings';
import type { ProductMasterPort } from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';
import {
  BATCHED_SWEEP_BUDGET_DEFAULT,
  BATCHED_SWEEP_BUDGET_MAX,
  SWEEP_BATCH_SIZE_DEFAULT,
  SWEEP_BATCH_SIZE_MAX,
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

// 100 is the lowest common denominator across ProductMasterPort adapters —
// WooCommerce's REST API hard-caps `per_page` at 100 and rejects anything
// higher with a 400, so a larger default permanently fails WC master syncs
// (#1723). PrestaShop has no such cap.
const DEFAULT_PAGE_SIZE = 100;

@Injectable()
export class MasterProductSyncAllHandler implements SyncJobHandler {
  private readonly logger = new Logger(MasterProductSyncAllHandler.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
    // `ISyncCursorsService`, not `ConnectionCursorRepositoryPort`: a repository
    // port is an intra-context contract and reaching across to `sync`'s would
    // trip `check-cross-context-imports` (the same reasoning as
    // `destination-taxonomy-sync.handler.ts`).
    @Inject(SYNC_CURSORS_SERVICE_TOKEN)
    private readonly cursors: ISyncCursorsService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    @Inject(OPERATIONAL_SETTINGS_SERVICE_TOKEN)
    private readonly operationalSettings: IOperationalSettingsService,
    private readonly configService: ConfigService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    // Read PER TICK, never cached at boot (#2651): a budget an operator has to
    // restart the worker to apply is barely better than the env var it
    // replaces. One singleton-row primary-key lookup, against a run that is
    // about to issue platform calls.
    const settings = await this.operationalSettings.resolve();
    const budget = resolveSweepBudget(this.getPayload(job).pageLimit ?? this.getConfiguredBudget(settings), {
      default: BATCHED_SWEEP_BUDGET_DEFAULT,
      max: BATCHED_SWEEP_BUDGET_MAX,
    });
    const batchSize = this.getBatchSize(settings);
    const lockKey = sweepLockKey('product', job.connectionId);
    const lockTtlMs = resolveSweepLockTtlMs(
      this.configService.get<string>('OL_MASTER_SWEEP_LOCK_TTL_MS')
    );

    const lockToken = await this.syncLock.acquire(lockKey, lockTtlMs);
    if (lockToken === null) {
      // Contention is not a failure — the holder is doing this connection's work.
      // Same semantics as the taxonomy sync: log and return ok, never throw.
      this.logger.log(
        `master.product.syncAll skipped for connection ${job.connectionId}: ${lockKey} already in progress`
      );
      return { outcome: 'ok' };
    }

    try {
      const productMaster = await this.integrationsService.getCapabilityAdapter<ProductMasterPort>(
        job.connectionId,
        'ProductMaster'
      );
      const cursorKey = sweepCursorKey('product', job.connectionId);
      const cursor = parseSweepCursor(await this.cursors.getCursor(job.connectionId, cursorKey));

      const result = await runBoundedSweep({
        cursor,
        budget,
        readPage: (offset, pageBudget) =>
          readPagedIds(
            (pageOffset, limit) => productMaster.listExternalIds({ limit, offset: pageOffset }),
            offset,
            pageBudget,
            this.getPageSize()
          ),
        groupSize: batchSize,
        enqueue: (externalIds, cycleId) => this.enqueueChild(job, externalIds, cycleId),
        newCycleId: () => randomUUID(),
      });

      await this.cursors.advanceCursor(
        job.connectionId,
        cursorKey,
        // '' clears the cursor so the next tick starts a fresh cycle rather than
        // resuming a completed one.
        result.nextCursor === null ? '' : formatSweepCursor(result.nextCursor)
      );

      if (result.failed > 0) {
        this.logger.error(
          `master.product.syncAll for connection ${job.connectionId}: ${result.enqueued} enqueued, ` +
            `${result.failed} failed; cursor held at offset ${String(result.nextCursor?.offset ?? 0)} so the page retries next tick`
        );
      } else {
        this.logger.log(
          `master.product.syncAll for connection ${job.connectionId}: ${result.enqueued} product sync job(s) enqueued ` +
            `(cycle ${result.cycleId}, ${result.completed ? 'cycle complete' : `resuming at offset ${String(result.nextCursor?.offset ?? 0)}`})`
        );
      }

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `master.product.syncAll failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    } finally {
      // Best-effort: a release failure must never mask the run's own result. The
      // TTL bounds the damage, and an overlapping run is safe anyway because the
      // child key is cycle-scoped.
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
   * Enqueue one child covering a whole batch of products (#2593).
   *
   * The child is `master.product.syncBatch`, not one
   * `master.product.syncByExternalId` per id: a per-product child builds its own
   * adapter instance, so it cannot benefit from a bulk read no matter how cheap
   * the read is. The per-product job survives as the fallback for a failed batch
   * member and as the deletion-reconcile child.
   */
  private async enqueueChild(
    job: SyncJob,
    externalIds: readonly string[],
    cycleId: string
  ): Promise<unknown> {
    const jobRequest: SyncJobRequest = {
      // Sweep-triggered child, page-sized (#2593). Its own job type so ADR-050
      // can lane it by its own cost of starvation (#2594): a sweep child arrives
      // a budget wide, so it runs in `bulk`, not `realtime`.
      jobType: 'master.product.syncBatch',
      connectionId: job.connectionId,
      payload: {
        schemaVersion: 1,
        externalIds: [...externalIds],
      },
      // Keyed on the CYCLE and on the batch's FIRST id. A resuming tick is a
      // different job, so a job-scoped key would re-enqueue the same child under
      // a fresh key on every overlapping page (#2039's `reconcileId` lesson: a
      // job id is not a run identity). Cycle-scoping also makes a crash between
      // enqueue and cursor write safe - the retry produces identical keys, since
      // the same offset yields the same batch boundaries.
      idempotencyKey: `master:${job.connectionId}:product:syncBatch:${externalIds[0]}:${cycleId}`,
    };
    return this.jobEnqueue.enqueueJob(jobRequest);
  }

  /**
   * Defaults rather than throwing on a malformed payload, unlike the taxonomy
   * handler this pattern otherwise follows (`destination-taxonomy-sync.handler.ts`
   * raises on a missing payload). A sweep's payload carries nothing the run needs
   * — only an optional budget override — so refusing to run a scheduled sweep
   * over a malformed one would trade a healthy default for a dead job.
   */
  private getPayload(job: SyncJob): MasterProductSyncAllPayloadV1 {
    const payload = job.payload as unknown as Partial<MasterProductSyncAllPayloadV1> | null;
    return {
      schemaVersion: 1,
      pageLimit:
        payload && typeof payload.pageLimit === 'number' ? payload.pageLimit : undefined,
    };
  }

  /**
   * Items per run.
   *
   * The settings service owns the `row -> OL_PRODUCT_SYNC_PAGE_LIMIT ->
   * BATCHED_SWEEP_BUDGET_DEFAULT` ladder, so this is the same resolution the
   * env var used to provide on its own - an install that set nothing, or set
   * only the env var, gets the same number it got before #2651.
   *
   * An explicit payload `pageLimit` still wins: the scheduler descriptor is the
   * narrower statement.
   */
  private getConfiguredBudget(settings: OperationalSettingsView): number {
    return settings.catalogueSweepBudget.value;
  }

  /**
   * Products per batch child, clamped to PrestaShop's own collection page.
   *
   * `OL_PRODUCT_SYNC_BATCH_SIZE` is kept as a NARROWER, sweep-specific
   * override that applies only while no operator has set the shared page size.
   * Collapsing it into the shared setting would silently change the inventory
   * sweep's page size for an install that had tuned only this one - a
   * behaviour change on upgrade, which is precisely what the fall-through
   * design exists to avoid.
   */
  private getBatchSize(settings: OperationalSettingsView): number {
    if (settings.sweepPageSize.source === 'setting') {
      return settings.sweepPageSize.value;
    }
    const raw = this.configService.get<string>(
      'OL_PRODUCT_SYNC_BATCH_SIZE',
      String(settings.sweepPageSize.value)
    );
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return SWEEP_BATCH_SIZE_DEFAULT;
    return Math.min(Math.floor(parsed), SWEEP_BATCH_SIZE_MAX);
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
