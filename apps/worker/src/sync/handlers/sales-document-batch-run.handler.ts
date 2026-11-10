/**
 * Sales-document batch run handler (#3583, epic #3515)
 *
 * Handles `salesDocument.batch.run`: issues one connection's batch queue
 * through `ISalesDocumentBatchService.executeRun`, which re-evaluates each
 * queued order and enqueues the ordinary `invoicing.issue` /
 * `fiscalization.register` job. Scheduled slots and "Run now" both arrive here.
 *
 * Outcomes (ADR-007):
 * - a run that finished `completed` or `empty` is `ok`;
 * - `failed-to-start` (connection missing, not active, needs reconnecting) is a
 *   terminal `business_failure`: retrying cannot change the connection's
 *   status, and the run row already says why;
 * - `already-running` THROWS `ContendedWriteError`, so the runner defers the
 *   job WITHOUT consuming a retry attempt (#2613/#2617) and it runs after the
 *   current run ends. Another run holding the connection is contention, not a
 *   failure - spending the retry ladder on it could dead-letter a scheduled
 *   slot behind a long month-end run. Returning `ok` would consume the slot's
 *   idempotency key and the slot would never run.
 *
 * `bulk` lane: cron-paced orchestration of local reads and enqueues. The
 * documents themselves are the `fiscal`-lane jobs it enqueues, so a run never
 * holds a slot a buyer-facing document job is waiting for.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  SALES_DOCUMENT_BATCH_SERVICE_TOKEN,
  type ISalesDocumentBatchService,
} from '@openlinker/core/orders';
import {
  BatchRunSegmentValues,
  type BatchRunSegment,
  type SalesDocumentKind,
} from '@openlinker/core/sales-documents';
import type {
  SalesDocumentBatchRunPayloadV1,
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
} from '@openlinker/core/sync';
import { ContendedWriteError } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

const KNOWN_KINDS: readonly SalesDocumentKind[] = ['invoice', 'fiscal-receipt'];

@Injectable()
export class SalesDocumentBatchRunHandler implements SyncJobHandler {
  private readonly logger = new Logger(SalesDocumentBatchRunHandler.name);

  constructor(
    @Inject(SALES_DOCUMENT_BATCH_SERVICE_TOKEN)
    private readonly batches: ISalesDocumentBatchService,
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.readPayload(job);
    if (payload === null) {
      this.logger.error(`salesDocument.batch.run ${job.id}: unreadable payload, nothing run`);
      return { outcome: 'business_failure' };
    }

    const result = await this.batches.executeRun({
      connectionId: job.connectionId,
      trigger: payload.trigger,
      documentKinds: payload.documentKinds,
      segment: payload.segment,
      slotAt: payload.slotAt,
      startedByUserId: payload.startedByUserId,
    });

    if (result.status === 'already-running') {
      throw new ContendedWriteError(
        `salesDocument.batch.run: connection ${job.connectionId} already has run ` +
          `${result.runningRunId ?? 'unknown'} in progress; deferring`,
        `salesDocument.batch:${job.connectionId}`,
      );
    }

    return result.run.status === 'failed-to-start'
      ? { outcome: 'business_failure' }
      : { outcome: 'ok' };
  }

  private readPayload(job: SyncJob): {
    trigger: 'schedule' | 'manual';
    documentKinds: SalesDocumentKind[];
    segment: BatchRunSegment;
    slotAt: Date | null;
    startedByUserId: string | null;
  } | null {
    const raw = job.payload as unknown as Partial<SalesDocumentBatchRunPayloadV1>;
    if (raw.trigger !== 'schedule' && raw.trigger !== 'manual') return null;
    const rawKinds: readonly unknown[] = Array.isArray(raw.documentKinds) ? raw.documentKinds : [];
    const kinds = rawKinds.filter(
      (kind): kind is SalesDocumentKind =>
        typeof kind === 'string' && KNOWN_KINDS.includes(kind),
    );
    if (kinds.length === 0) return null;
    const segment = (BatchRunSegmentValues as readonly string[]).includes(raw.segment ?? '')
      ? (raw.segment as BatchRunSegment)
      : null;
    if (segment === null) return null;
    const slotAt = typeof raw.slotAt === 'string' ? new Date(raw.slotAt) : null;
    return {
      trigger: raw.trigger,
      documentKinds: kinds,
      segment,
      slotAt: slotAt !== null && !Number.isNaN(slotAt.getTime()) ? slotAt : null,
      startedByUserId: typeof raw.startedByUserId === 'string' ? raw.startedByUserId : null,
    };
  }
}
