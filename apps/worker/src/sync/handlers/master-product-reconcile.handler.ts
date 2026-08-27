/**
 * Master Product Reconcile Handler
 *
 * Handles jobs of type 'master.product.reconcile' — the deletion authority for the
 * product catalog (#2222, ADR-048 decision 2).
 *
 * **It enumerates OL's OWN product mappings, not the master.** That inversion is the
 * whole design. A catalog enumeration cannot reveal a deletion — the record simply
 * stops appearing — so `master.product.syncAll`, which reads ids *from* the master,
 * is structurally blind to it. Reading OL's mappings instead asks the opposite
 * question ("does this still exist?"), and the answer comes from re-checking each id:
 * the child's `MasterProductNotFoundError` is the authority, exactly as it already is
 * on the webhook path. This is the same shape `master.inventory.syncAll` has had all
 * along, which is why an `InventoryMaster` connection already had deletion detection
 * and a `ProductMaster`-only one did not.
 *
 * **Absence is never a signal here, and must not become one.** It would be cheaper to
 * diff the enumerated set against the mappings and stale the difference — and it would
 * be wrong. Neither shipped master paginates stably: `PrestashopProductMasterAdapter.listExternalIds`
 * sends no `sort` and `WooCommerceProductMasterAdapter.listExternalIds` no `orderby`
 * (WC defaults to `date DESC`). A cycle spans many ticks, so one mid-cycle delete
 * shifts every later row left and a LIVE product is never read. Staling on that
 * inference would zero a live product's offers on every marketplace via #1689. See
 * the ADR's #2222 amendment.
 *
 * Because the child is the authority, this handler needs no guards of its own: an
 * empty enumeration enqueues nothing and stales nothing, a missed mapping is simply
 * re-checked next cycle, and the #1904 rival-claimant guard lives where the write is.
 *
 * Its own lock, for #2220's reason: sharing `master:product:sweep` would let the full
 * sweep — mid-cycle more or less permanently on a large catalog — starve it.
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
  MasterProductReconcilePayloadV1,
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
import {
  IdentifierMappingQueryPort,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  CORE_ENTITY_TYPE,
} from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import {
  formatSweepCursor,
  parseSweepCursor,
  resolveSweepBudget,
  resolveSweepLockTtlMs,
  runBoundedSweep,
  sweepCompletedAtCursorKey,
  sweepCursorKey,
  sweepLockKey,
  readMappingPage,
} from '../bounded-sweep';

type SyncJob = SyncJobEntity;

@Injectable()
export class MasterProductReconcileHandler implements SyncJobHandler {
  private readonly logger = new Logger(MasterProductReconcileHandler.name);

  constructor(
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    // The narrow QUERY port, matching the inventory sweep: this pass only reads.
    private readonly identifierMapping: IdentifierMappingQueryPort,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
    @Inject(SYNC_CURSORS_SERVICE_TOKEN)
    private readonly cursors: ISyncCursorsService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    private readonly configService: ConfigService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const budget = resolveSweepBudget(this.getPayload(job).pageLimit);
    const lockKey = sweepLockKey('product-reconcile', job.connectionId);
    const lockTtlMs = resolveSweepLockTtlMs(
      this.configService.get<string>('OL_MASTER_SWEEP_LOCK_TTL_MS')
    );

    const lockToken = await this.syncLock.acquire(lockKey, lockTtlMs);
    if (lockToken === null) {
      this.logger.log(
        `master.product.reconcile skipped for connection ${job.connectionId}: ${lockKey} already in progress`
      );
      return { outcome: 'ok' };
    }

    try {
      const cursorKey = sweepCursorKey('product-reconcile', job.connectionId);
      const cursor = parseSweepCursor(await this.cursors.getCursor(job.connectionId, cursorKey));

      const result = await runBoundedSweep({
        cursor,
        budget,
        readPage: (offset, pageBudget) =>
          readMappingPage(
            (page) =>
              this.identifierMapping.listExternalIdsByConnection(
                CORE_ENTITY_TYPE.Product,
                job.connectionId,
                page
              ),
            offset,
            pageBudget
          ),
        // One id per child: this sweep keeps the per-item fan-out.
        enqueue: (externalIds, cycleId) => this.enqueueChild(job, externalIds[0], cycleId),
        newCycleId: () => randomUUID(),
      });

      await this.cursors.advanceCursor(
        job.connectionId,
        cursorKey,
        result.nextCursor === null ? '' : formatSweepCursor(result.nextCursor)
      );

      if (result.completed) {
        // The operator-facing "deletion last reconciled" fact (#2258, ADR-048
        // decision 2). Deliberately AFTER the sweep-cursor clear: a crash
        // between the two leaves a completed-but-unstamped cycle, which is
        // acceptable for a display fact — moving the write before the clear
        // would instead stamp a completion whose cursor write may then fail,
        // the worse direction. `advanceCursor` is non-monotonic; the per-
        // connection sweep lock makes overlapping completions effectively
        // unreachable, and last-writer-wins is acceptable for this fact.
        //
        // Best-effort, never thrown (the #2024 supplementary-write posture):
        // the sweep cursor is already cleared, so failing the job here would
        // retry into a FRESH cycle — re-enqueueing a full page of per-product
        // children for a cycle that already completed. The stamp self-heals
        // on the next completing cycle.
        try {
          await this.cursors.advanceCursor(
            job.connectionId,
            sweepCompletedAtCursorKey('product-reconcile', job.connectionId),
            new Date().toISOString()
          );
        } catch (stampError) {
          this.logger.warn(
            `Failed to stamp reconcile completion for connection ${job.connectionId}: ${
              stampError instanceof Error ? stampError.message : String(stampError)
            }`
          );
        }
      }

      if (result.failed > 0) {
        this.logger.error(
          `master.product.reconcile for connection ${job.connectionId}: ${result.enqueued} enqueued, ` +
            `${result.failed} failed; cursor held at offset ${String(result.nextCursor?.offset ?? 0)} so the page retries next tick`
        );
      } else {
        this.logger.log(
          `master.product.reconcile for connection ${job.connectionId}: ${result.enqueued} product re-check(s) enqueued ` +
            `(cycle ${result.cycleId}, ${result.completed ? 'cycle complete' : `resuming at offset ${String(result.nextCursor?.offset ?? 0)}`})`
        );
      }

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `master.product.reconcile failed: ${message}`,
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
      // The SAME child the sweeps enqueue. A live product simply re-syncs
      // (idempotent); a deleted one raises MasterProductNotFoundError and flows
      // into the deletion authority. This handler never writes staleness itself.
      jobType: 'master.product.syncByExternalId',
      connectionId: job.connectionId,
      payload: {
        schemaVersion: 1,
        externalId,
        objectType: CORE_ENTITY_TYPE.Product,
      },
      // Cycle-scoped, in a namespace of its own so a re-check never dedups against
      // a concurrent full-sweep or delta child for the same product (#2039).
      idempotencyKey: `master:${job.connectionId}:product:reconcile:${externalId}:${cycleId}`,
    };
    return this.jobEnqueue.enqueueJob(jobRequest);
  }

  /** Defaults rather than throwing on a malformed payload — see the sweep handlers. */
  private getPayload(job: SyncJob): MasterProductReconcilePayloadV1 {
    const payload = job.payload as unknown as Partial<MasterProductReconcilePayloadV1> | null;
    return {
      schemaVersion: 1,
      pageLimit: payload && typeof payload.pageLimit === 'number' ? payload.pageLimit : undefined,
    };
  }
}
