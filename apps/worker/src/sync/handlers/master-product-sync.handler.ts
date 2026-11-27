/**
 * Master Product Sync Handler (Generic)
 *
 * Thin delegate for jobs of type 'master.product.syncByExternalId'.
 * Legacy job types (e.g., 'prestashop.product.syncByExternalId') should be aliased
 * to this handler during migration.
 *
 * @module apps/worker/src/sync/handlers
 */

import { Injectable, Inject } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  MasterProductSyncByExternalIdPayloadV1,
} from '@openlinker/core/sync';
import {
  SyncJobExecutionError,
  JobEnqueuePort,
  JOB_ENQUEUE_TOKEN,
  SyncJobRepositoryPort,
  SYNC_JOB_REPOSITORY_TOKEN,
  RetryClassifierRegistryService,
  RETRY_CLASSIFIER_REGISTRY_TOKEN,
} from '@openlinker/core/sync';
import type { MasterProductSyncResult } from '@openlinker/core/products';
import {
  IMasterProductSyncService,
  MASTER_PRODUCT_SYNC_SERVICE_TOKEN,
} from '@openlinker/core/products';
import {
  IdentifierMappingQueryPort,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
} from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import { propagateTaxRateChanges } from './tax-rate-propagation';
import {
  MAX_DEFERRED_TOTAL_SECONDS_DEFAULT,
  RATE_LIMIT_TIMEOUT_REQUEUE_DELAY_SECONDS,
  calculateRetryBackoffSeconds,
  isNonRetryableFailure,
  isRateLimitTimeoutFailure,
  resolveFailureDeferral,
} from '../job-failure-policy';

type SyncJob = SyncJobEntity;

/** Peers claimed per drain (#3986). 1 disables the drain; clamped to 1..100. */
const DRAIN_BATCH_SIZE_DEFAULT = 50;
const DRAIN_BATCH_SIZE_MAX = 100;
/**
 * Peers are claimed `running` with `lockedAt = now`; stuck-job recovery requeues
 * a row whose lock is older than its timeout (15 min). A drain of 100 products
 * can outlast that, so the peers are heartbeated while the sync runs (the
 * runner's own cadence, `heartbeat` is guarded on `lockedBy`).
 */
const PEER_HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000;

function resolveMaxDeferredTotalSeconds(raw: string | undefined): number {
  const parsed = Number(raw);
  return raw === undefined || raw === '' || !Number.isFinite(parsed) || parsed < 1
    ? MAX_DEFERRED_TOTAL_SECONDS_DEFAULT
    : Math.round(parsed);
}

/** Read per call so a change needs no restart; invalid values fall back to the default. */
export function resolveHookDrainBatchSize(
  raw: string | undefined = process.env.OL_HOOK_SYNC_DRAIN_BATCH_SIZE
): number {
  const parsed = Number(raw);
  if (raw === undefined || raw === '' || !Number.isFinite(parsed)) {
    return DRAIN_BATCH_SIZE_DEFAULT;
  }
  return Math.min(DRAIN_BATCH_SIZE_MAX, Math.max(1, Math.floor(parsed)));
}

@Injectable()
export class MasterProductSyncHandler implements SyncJobHandler {
  private readonly logger = new Logger(MasterProductSyncHandler.name);

  constructor(
    @Inject(MASTER_PRODUCT_SYNC_SERVICE_TOKEN)
    private readonly masterProductSync: IMasterProductSyncService,
    // #2263 - the propagation is an outbound offer write, so it is enqueued
    // here rather than inside the products context (which has no `sync` edge).
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
    // The narrow QUERY port: this handler only reads which offers a variant has.
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IdentifierMappingQueryPort,
    // #3986 - the drain claims queued peer jobs of the same connection.
    @Inject(SYNC_JOB_REPOSITORY_TOKEN)
    private readonly jobRepository: SyncJobRepositoryPort,
    // Drained peers are settled here, so they need the same classifier the
    // runner applies to its own job.
    @Inject(RETRY_CLASSIFIER_REGISTRY_TOKEN)
    private readonly retryClassifierRegistry: RetryClassifierRegistryService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    if (String(payload.objectType).toLowerCase() !== 'product') {
      throw new SyncJobExecutionError(
        `Invalid objectType for master product sync: ${String(payload.objectType)}. Expected 'Product'.`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }

    this.logger.log(
      `Executing master product sync job ${job.id} (connection: ${job.connectionId}, externalId: ${String(payload.externalId)})`
    );

    const peers = await this.claimPeers(job);
    if (peers.length > 0) {
      return this.executeDrained(job, payload.externalId, peers);
    }

    try {
      const result = await this.masterProductSync.syncFromMasterByExternalId(
        job.connectionId,
        payload.externalId
      );

      // The staleness prune did not run. Two causes with completely different
      // remediations, so they are reported as different lines rather than one
      // ambiguous "prune skipped" (#2222): a #1904 collision needs the operator
      // to resolve which connection owns the id, while a zero-variant response
      // needs nothing at all unless it persists, in which case the master is
      // flaky. Neither is a business failure - the upserts (or the deletion
      // signal below) still stand.
      if (result.pruneSkippedReason === 'rival') {
        this.logger.warn(
          `Master product sync: staleness prune skipped - internal product id claimed by more than one ProductMaster connection (job ${job.id}, connection: ${job.connectionId}, externalId: ${String(payload.externalId)}, internalProductId: ${result.internalProductId})`
        );
      } else if (result.pruneSkippedReason === 'empty-response') {
        this.logger.warn(
          `Master product sync: staleness prune skipped - the master returned zero variants for an existing product, which is ambiguous enough that pruning would risk staling every variant (job ${job.id}, connection: ${job.connectionId}, externalId: ${String(payload.externalId)}, internalProductId: ${result.internalProductId})`
        );
      }

      // A product deleted at the master is a terminal business outcome, not a
      // transient failure — return business_failure so the runner does NOT retry
      // a permanent condition (#1599, ADR-007). The variants were marked stale.
      if (result.masterDeleted) {
        this.logger.warn(
          `Master product sync: product deleted at master (job ${job.id}, connection: ${job.connectionId}, externalId: ${String(payload.externalId)})`
        );
        return { outcome: 'business_failure', outcomeReason: 'master_deleted' };
      }

      // #3143/#3159 review, SUGGESTION: `priceChangeObserverFailures` was
      // computed by the service but never read here, so a permanently-failing
      // detector produced `outcome: 'ok'` with nothing visible anywhere.
      // Warn-only — never a business_failure — because the catalogue sync
      // this job exists to run still succeeded; the failure is already
      // logged at `error` per-variant by the service itself, this just makes
      // the per-job total visible on the job's own log line.
      if (result.priceChangeObserverFailures > 0) {
        this.logger.warn(
          `Master product sync: ${result.priceChangeObserverFailures} price-change observer call(s) failed and were NOT reported (job ${job.id}, connection: ${job.connectionId}, externalId: ${String(payload.externalId)}, internalProductId: ${result.internalProductId})`
        );
      }

      // #2263 (ADR-063): the shop is the authority, so a rate it just changed is
      // pushed onto the offers already selling under the old one. Strictly after
      // the sync and outside its try: a propagation failure must not turn a
      // completed catalogue sync into a retried one, and the next change (or the
      // next sweep that observes one) enqueues again.
      await propagateTaxRateChanges(
        {
          jobEnqueue: this.jobEnqueue,
          identifierMapping: this.identifierMapping,
          logger: this.logger,
        },
        job.connectionId,
        result.taxRateChanges
      );

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Master product sync failed (externalId: ${String(payload.externalId)}): ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Drain-claim batching (#3986): take queued sibling webhook jobs of this
   * connection so one slot-turn syncs many products through one adapter
   * instance (one prefetch where the master declares `BulkProductReader`).
   * Every webhook keeps its own durable job; nothing is coalesced at enqueue.
   * A failure of the claim itself falls back to this job alone.
   */
  private async claimPeers(job: SyncJob): Promise<SyncJob[]> {
    const size = resolveHookDrainBatchSize();
    // Webhook-driven jobs only: the sweep-triggered twin shares this handler
    // but lives in `bulk` and is already page-batched by the sweep itself.
    if (size <= 1 || !job.lockedBy || job.jobType !== 'master.product.syncByExternalId') {
      return [];
    }
    try {
      return await this.jobRepository.claimQueuedPeers({
        jobType: job.jobType,
        connectionId: job.connectionId,
        limit: size - 1,
        workerId: job.lockedBy,
        excludeJobId: job.id,
      });
    } catch (error) {
      this.logger.warn(
        `Peer claim failed for job ${job.id}; processing it alone: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }

  private async executeDrained(
    job: SyncJob,
    ownExternalId: string,
    claimed: SyncJob[]
  ): Promise<SyncJobHandlerResult> {
    const peers: { job: SyncJob; externalId: string }[] = [];
    for (const peer of claimed) {
      const body = peer.payload as { externalId?: unknown; objectType?: unknown } | null;
      const externalId = body?.externalId;
      if (
        typeof externalId === 'string' &&
        externalId.length > 0 &&
        String(body?.objectType).toLowerCase() === 'product'
      ) {
        peers.push({ job: peer, externalId });
      } else {
        await this.failPeer(peer, 'Invalid payload for master product sync');
      }
    }

    const ids = [...new Set([ownExternalId, ...peers.map((p) => p.externalId)])];
    this.logger.log(
      `Drained ${String(peers.length)} peer job(s) into job ${job.id} (connection: ${job.connectionId}, products: ${String(ids.length)})`
    );

    const startedAt = Date.now();
    const heartbeat = setInterval(() => {
      for (const peer of peers) {
        void this.jobRepository.heartbeat(peer.job.id, peer.job.lockedBy ?? '').catch((error) => {
          this.logger.warn(
            `Heartbeat failed for drained peer ${peer.job.id}: ${error instanceof Error ? error.message : String(error)}`
          );
        });
      }
    }, PEER_HEARTBEAT_INTERVAL_MS);
    if (typeof heartbeat.unref === 'function') {
      heartbeat.unref();
    }

    let batch;
    try {
      batch = await this.masterProductSync.syncFromMasterByExternalIds(job.connectionId, ids);
    } catch (error) {
      clearInterval(heartbeat);
      // Whole-page failure (adapter/credentials): hand the peers straight back
      // so each runs on its own ladder, and fail only this job.
      for (const peer of peers) {
        await this.releasePeer(peer.job);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Master product sync failed (externalId: ${ownExternalId}, drained ${String(peers.length)} peer(s)): ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
    clearInterval(heartbeat);
    const attemptDurationMs = Date.now() - startedAt;

    // `results` carries no id, but holds one entry per NON-failed id in input
    // order (the service pushes in input order and only successes), so the
    // i-th success id owns the i-th result.
    const failureById = new Map(batch.failures.map((f) => [f.externalId, f]));
    const resultById = new Map<string, MasterProductSyncResult>();
    ids
      .filter((id) => !failureById.has(id))
      .forEach((id, index) => {
        const one = batch.results[index];
        if (one) {
          resultById.set(id, one);
        }
      });

    for (const peer of peers) {
      const failure = failureById.get(peer.externalId);
      const one = resultById.get(peer.externalId);
      if (failure !== undefined || !one) {
        await this.failPeer(
          peer.job,
          failure?.message ?? 'No result returned for drained product',
          failure?.error,
          attemptDurationMs
        );
      } else {
        await this.succeedPeer(peer.job, one);
      }
    }

    for (const one of batch.results) {
      await propagateTaxRateChanges(
        {
          jobEnqueue: this.jobEnqueue,
          identifierMapping: this.identifierMapping,
          logger: this.logger,
        },
        job.connectionId,
        one.taxRateChanges
      );
    }

    const ownFailure = failureById.get(ownExternalId);
    if (ownFailure !== undefined) {
      throw new SyncJobExecutionError(
        `Master product sync failed (externalId: ${ownExternalId}): ${ownFailure.message}`,
        job.id,
        job.jobType,
        job.connectionId,
        // The original error as `cause`, so the runner's classification
        // (deferral, contended write, non-retryable) sees what it would have
        // seen had this job run alone.
        ownFailure.error instanceof Error ? ownFailure.error : undefined
      );
    }
    if (resultById.get(ownExternalId)?.masterDeleted) {
      return { outcome: 'business_failure', outcomeReason: 'master_deleted' };
    }
    return { outcome: 'ok' };
  }

  private async succeedPeer(peer: SyncJob, one: MasterProductSyncResult): Promise<void> {
    try {
      if (one.masterDeleted) {
        await this.jobRepository.markSucceeded(peer.id, 'business_failure', 'master_deleted');
      } else {
        await this.jobRepository.markSucceeded(peer.id, 'ok');
      }
    } catch (error) {
      // The sync is idempotent: leaving the row `running` lets stuck-job
      // recovery requeue it, which re-runs harmlessly.
      this.logger.error(
        `Could not mark drained peer ${peer.id} succeeded: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Per-peer failure, classified exactly as `SyncJobRunner.handleJobFailure`
   * would have classified it had the peer run alone: limiter timeout and
   * 429/503/contended deferrals are penalty-free (inside the deferral budget),
   * a non-retryable error dies at once, anything else takes the ordinary ladder.
   * With no original `error` (an invalid payload) it is the ladder alone.
   * Unlike the runner, a credential rejection does not flag the connection
   * `needs_reauth` here: the own job of the same drain fails on the same
   * credentials and the runner flags it from that.
   */
  private async failPeer(
    peer: SyncJob,
    message: string,
    error?: unknown,
    attemptDurationMs?: number
  ): Promise<void> {
    try {
      if (error !== undefined) {
        if (isRateLimitTimeoutFailure(error)) {
          await this.jobRepository.requeueWithoutPenalty(
            peer.id,
            message,
            new Date(Date.now() + RATE_LIMIT_TIMEOUT_REQUEUE_DELAY_SECONDS * 1000),
            { lastAttemptDurationMs: null }
          );
          return;
        }
        const registries = { retry: this.retryClassifierRegistry };
        if (isNonRetryableFailure(error, registries)) {
          await this.jobRepository.markDead(peer.id, message, attemptDurationMs);
          return;
        }
        const deferral = resolveFailureDeferral(error, registries);
        if (deferral !== null) {
          const budgetMs =
            resolveMaxDeferredTotalSeconds(process.env.OL_JOB_MAX_DEFERRED_WAIT_SECONDS) * 1000;
          const deferredTotalMs = (peer.deferredTotalMs ?? 0) + deferral.delaySeconds * 1000;
          if (deferredTotalMs <= budgetMs) {
            await this.jobRepository.requeueWithoutPenalty(
              peer.id,
              `${deferral.reason} (deferred ${Math.round(deferredTotalMs / 1000)}s of ` +
                `${Math.round(budgetMs / 1000)}s budget): ${message}`,
              new Date(Date.now() + deferral.delaySeconds * 1000),
              { lastAttemptDurationMs: attemptDurationMs ?? null, deferredTotalMs }
            );
            return;
          }
        }
      }
      if (peer.attempts + 1 >= peer.maxAttempts) {
        await this.jobRepository.markDead(peer.id, message, attemptDurationMs);
        return;
      }
      const delaySeconds = calculateRetryBackoffSeconds(peer.attempts + 1);
      await this.jobRepository.markFailed(
        peer.id,
        message,
        new Date(Date.now() + delaySeconds * 1000),
        attemptDurationMs
      );
    } catch (error) {
      this.logger.error(
        `Could not record failure of drained peer ${peer.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async releasePeer(peer: SyncJob): Promise<void> {
    try {
      await this.jobRepository.requeueWithoutPenalty(
        peer.id,
        'Released: drain batch failed as a whole, re-queued to run alone (#3986)',
        new Date()
      );
    } catch (error) {
      this.logger.error(
        `Could not release drained peer ${peer.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private getPayload(job: SyncJob): MasterProductSyncByExternalIdPayloadV1 {
    const payload = job.payload as unknown as Partial<MasterProductSyncByExternalIdPayloadV1>;
    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (!payload.externalId || typeof payload.externalId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid externalId in job payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (!payload.objectType || typeof payload.objectType !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid objectType in job payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    return {
      schemaVersion: 1,
      externalId: payload.externalId,
      objectType: payload.objectType as 'Product',
    };
  }
}
