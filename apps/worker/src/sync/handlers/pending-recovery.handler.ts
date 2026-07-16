/**
 * Pending Recovery Handler (#1703, mini-epic #1585)
 *
 * Thin delegate for jobs of type `invoicing.pendingRecovery.sweep`. Resolves one
 * page of a connection's invoice records left stuck mid-issuance by a process
 * crash via the core `PendingRecoveryService` (which queries the authority
 * through the `RegulatoryRecordLocator` sub-capability and reconciles, or marks
 * the record in-doubt for manual review - never a silent auto-retry). The
 * scheduler fans this out, one job per `Invoicing` connection.
 *
 * No PERSISTED cursor across runs: the service walks an intra-run `(updatedAt,
 * id)` keyset cursor that drains the whole stuck frontier each run, so this
 * handler injects no cursor repository. The payload `limit` is the per-PAGE size,
 * validated AND clamped to `MAX_LIMIT`. The outer catch only interpolates
 * OL-shaped messages - the service never re-throws a raw provider error past its
 * per-record loop.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  PendingRecoverySweepPayloadV1,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import {
  IPendingRecoveryService,
  PENDING_RECOVERY_SERVICE_TOKEN,
} from '@openlinker/core/invoicing';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

const DEFAULT_LIMIT = 100;
/** Upper bound on the page size - caps `take` regardless of payload. */
const MAX_LIMIT = 500;

@Injectable()
export class PendingRecoveryHandler implements SyncJobHandler {
  private readonly logger = new Logger(PendingRecoveryHandler.name);

  constructor(
    @Inject(PENDING_RECOVERY_SERVICE_TOKEN)
    private readonly pendingRecoveryService: IPendingRecoveryService,
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing invoicing.pendingRecovery.sweep job ${job.id} for connection ${job.connectionId} (limit=${payload.limit})`,
    );

    try {
      const result = await this.pendingRecoveryService.recover(job.connectionId, {
        limit: payload.limit,
      });

      this.logger.log(
        `invoicing.pendingRecovery.sweep completed (connection=${job.connectionId}): scanned=${result.scanned}, recovered=${result.recovered}, markedInDoubt=${result.markedInDoubt}, errors=${result.errors}, total=${result.total}`,
      );

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Pending recovery failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private getPayload(job: SyncJob): PendingRecoverySweepPayloadV1 {
    const payload = job.payload as Partial<PendingRecoverySweepPayloadV1> | undefined;

    if (payload === null || typeof payload !== 'object' || payload.schemaVersion !== 1) {
      throw new SyncJobExecutionError(
        `Invalid invoicing.pendingRecovery.sweep payload: expected an object with schemaVersion=1`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    // Default an absent / non-positive limit to DEFAULT_LIMIT, then clamp to
    // MAX_LIMIT so a payload-supplied limit can never blow the page size past
    // the cap.
    const limit = Math.min(
      typeof payload.limit === 'number' && payload.limit > 0 ? payload.limit : DEFAULT_LIMIT,
      MAX_LIMIT,
    );

    return { schemaVersion: 1, limit };
  }
}
