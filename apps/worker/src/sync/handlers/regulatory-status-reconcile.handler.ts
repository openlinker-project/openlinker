/**
 * Regulatory Status Reconcile Handler (#1121)
 *
 * Thin delegate for jobs of type `invoicing.regulatoryStatus.reconcile`.
 * Refreshes one page of a connection's issued + non-terminal invoice records via
 * the core `RegulatoryStatusReconciliationService` (which reads authoritative
 * provider/CTC status through the `RegulatoryStatusReader` sub-capability). The
 * scheduler fans this out, one job per `Invoicing` connection; connections whose
 * adapter lacks the reader no-op in the service.
 *
 * NO cursor (the reconciliation frontier is a shrinking set walked from offset 0
 * every run — plan decision #5), so this handler does NOT inject
 * `ConnectionCursorRepositoryPort`. The payload `limit` is validated AND clamped
 * to `MAX_LIMIT` (decision #13). The outer catch only ever interpolates
 * OL-shaped messages — the service never re-throws a raw provider error past its
 * per-record loop (#8e).
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  RegulatoryStatusReconcilePayloadV1,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import {
  IRegulatoryStatusReconciliationService,
  REGULATORY_STATUS_RECONCILIATION_SERVICE_TOKEN,
} from '@openlinker/core/invoicing';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

const DEFAULT_LIMIT = 100;
/** Upper bound on the page size (decision #13) — caps `take` regardless of payload. */
const MAX_LIMIT = 500;

@Injectable()
export class RegulatoryStatusReconcileHandler implements SyncJobHandler {
  private readonly logger = new Logger(RegulatoryStatusReconcileHandler.name);

  constructor(
    @Inject(REGULATORY_STATUS_RECONCILIATION_SERVICE_TOKEN)
    private readonly reconciliationService: IRegulatoryStatusReconciliationService,
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing invoicing.regulatoryStatus.reconcile job ${job.id} for connection ${job.connectionId} (limit=${payload.limit})`,
    );

    try {
      const result = await this.reconciliationService.reconcile(job.connectionId, {
        limit: payload.limit,
      });

      this.logger.log(
        `invoicing.regulatoryStatus.reconcile completed (connection=${job.connectionId}): scanned=${result.scanned}, updated=${result.updated}, skippedTerminal=${result.skippedTerminal}, readErrors=${result.readErrors}, total=${result.total}`,
      );

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Regulatory status reconcile failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private getPayload(job: SyncJob): RegulatoryStatusReconcilePayloadV1 {
    const payload = job.payload as Partial<RegulatoryStatusReconcilePayloadV1> | undefined;

    if (
      payload === null ||
      typeof payload !== 'object' ||
      payload.schemaVersion !== 1
    ) {
      throw new SyncJobExecutionError(
        `Invalid invoicing.regulatoryStatus.reconcile payload: expected an object with schemaVersion=1`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    // Default an absent / non-positive limit to DEFAULT_LIMIT, then clamp to
    // MAX_LIMIT so a payload-supplied limit can never blow the page size past
    // the cap (decision #13).
    const limit = Math.min(
      typeof payload.limit === 'number' && payload.limit > 0 ? payload.limit : DEFAULT_LIMIT,
      MAX_LIMIT,
    );

    return { schemaVersion: 1, limit };
  }
}
