/**
 * Sales-document batch tick handler (#3583, epic #3515)
 *
 * Handles `salesDocument.batch.tick`, the scheduler's 5-minute pass. For every
 * active connection that batches a document kind, it reads the kind's schedule
 * from the connection's config, finds the slots due now, and enqueues one
 * `salesDocument.batch.run` per due slot.
 *
 * ## Why one tick and not a cron task per connection
 *
 * A cron expression is fixed when the scheduler starts (the ADR-069 limit), so
 * a per-connection task would need a restart for every schedule edit. Reading
 * the config on each tick applies an edit on the next pass.
 *
 * ## At most one run per slot, with no cursor
 *
 * The run job's idempotency key is built from the slot
 * (`buildScheduledBatchRunKey`), and `sync_jobs.idempotencyKey` is unique. The
 * tick sees the same slot on every pass until the next one comes round; every
 * pass after the first is a deduped no-op. Kinds due at the same instant and
 * segment share ONE run, because two runs on one connection cannot overlap and
 * the second would otherwise have to wait for a retry.
 *
 * 5-minute resolution is the precision contract: "18:00" runs between 18:00
 * and 18:05.
 *
 * ## A connection that cannot issue still gets its slot recorded
 *
 * Every non-disabled connection is considered, not only `active` ones: a slot
 * that falls due while a connection needs reconnecting (or is in error) still
 * enqueues its run, and the run finishes `failed-to-start` with that reason
 * and leaves the queue untouched (#3583 AC). Skipping such a connection would
 * leave the slot with no trace in the run history. A `disabled` connection is
 * skipped: an operator switched it off on purpose.
 *
 * ## Untargeted batched blocks
 *
 * Each tick also asks the batch service to re-evaluate a bounded slice of
 * orders whose batched block predates the queue's target columns, so they land
 * in a queue instead of being visible nowhere (`requeueUntargetedBatched`).
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  CONNECTION_PORT_TOKEN,
  type Connection,
  type ConnectionPort,
} from '@openlinker/core/identifier-mapping';
import {
  SALES_DOCUMENT_BATCH_SERVICE_TOKEN,
  batchedDocumentKinds,
  buildScheduledBatchRunKey,
  type ISalesDocumentBatchService,
} from '@openlinker/core/orders';
import {
  findDueBatchSlots,
  readBatchSchedule,
  type DueBatchSlot,
  type SalesDocumentKind,
} from '@openlinker/core/sales-documents';
import type {
  SalesDocumentBatchRunPayloadV1,
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
} from '@openlinker/core/sync';
import { JOB_ENQUEUE_TOKEN, type JobEnqueuePort } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

const INVOICING_CAPABILITY = 'Invoicing';
const FISCALIZATION_CAPABILITY = 'Fiscalization';

export interface DueRun {
  slot: DueBatchSlot;
  kinds: SalesDocumentKind[];
}

/** Due slots per kind, grouped so kinds sharing an instant and segment run together. */
export function collectDueRuns(connection: Connection, now: Date): DueRun[] {
  const runs = new Map<string, DueRun>();
  for (const kind of batchedDocumentKinds(connection.config)) {
    const schedule = readBatchSchedule(connection.config, kind);
    if (schedule === null) continue;
    for (const slot of findDueBatchSlots(schedule, now)) {
      const key = `${slot.segment}@${slot.slotAt.toISOString()}`;
      const existing = runs.get(key);
      if (existing === undefined) {
        runs.set(key, { slot, kinds: [kind] });
      } else {
        existing.kinds.push(kind);
      }
    }
  }
  return [...runs.values()];
}

@Injectable()
export class SalesDocumentBatchTickHandler implements SyncJobHandler {
  private readonly logger = new Logger(SalesDocumentBatchTickHandler.name);

  constructor(
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connections: ConnectionPort,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
    @Inject(SALES_DOCUMENT_BATCH_SERVICE_TOKEN)
    private readonly batches: ISalesDocumentBatchService,
  ) {}

  async execute(_job: SyncJob): Promise<SyncJobHandlerResult> {
    const now = new Date();
    const candidates = (await this.connections.list()).filter(
      (connection) =>
        connection.status !== 'disabled' &&
        (connection.enabledCapabilities.includes(INVOICING_CAPABILITY) ||
          connection.enabledCapabilities.includes(FISCALIZATION_CAPABILITY)),
    );

    let enqueued = 0;
    let failed = 0;
    for (const connection of candidates) {
      for (const due of collectDueRuns(connection, now)) {
        const payload: SalesDocumentBatchRunPayloadV1 = {
          schemaVersion: 1,
          trigger: 'schedule',
          documentKinds: due.kinds,
          segment: due.slot.segment,
          slotAt: due.slot.slotAt.toISOString(),
        };
        try {
          const result = await this.jobEnqueue.enqueueJob({
            jobType: 'salesDocument.batch.run',
            connectionId: connection.id,
            payload: payload as unknown as Record<string, unknown>,
            idempotencyKey: buildScheduledBatchRunKey({
              connectionId: connection.id,
              documentKinds: due.kinds,
              segment: due.slot.segment,
              slotAt: due.slot.slotAt,
            }),
          });
          if (!result.isExisting) enqueued += 1;
        } catch (error) {
          // One connection's enqueue failure must not starve the others; the
          // slot stays due, so the next tick retries it.
          failed += 1;
          const name = error instanceof Error ? error.name : 'UnknownError';
          this.logger.warn(
            `salesDocument.batch.tick: could not enqueue a run for connection ${connection.id}: ` +
              `error=${name}`,
          );
        }
      }
    }

    try {
      await this.batches.requeueUntargetedBatched();
    } catch (error) {
      // Best-effort: a failure here must not cost the slots above their runs.
      const name = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`salesDocument.batch.tick: untargeted requeue failed: error=${name}`);
    }

    if (enqueued > 0 || failed > 0) {
      this.logger.log(
        `salesDocument.batch.tick: enqueued=${String(enqueued)} failed=${String(failed)}`,
      );
    }
    return { outcome: 'ok' };
  }
}
