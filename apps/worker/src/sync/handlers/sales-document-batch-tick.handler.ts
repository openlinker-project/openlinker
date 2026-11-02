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
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  CONNECTION_PORT_TOKEN,
  type Connection,
  type ConnectionPort,
} from '@openlinker/core/identifier-mapping';
import { resolveTriggerModelForKind } from '@openlinker/core/invoicing';
import { buildScheduledBatchRunKey } from '@openlinker/core/orders';
import {
  findDueBatchSlots,
  readBatchSchedule,
  readSalesDocumentRouting,
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

/** The concrete kinds a connection's `documentKind` issues. */
function kindsIssuedBy(connection: Connection): SalesDocumentKind[] {
  const { documentKind } = readSalesDocumentRouting(connection.config);
  if (documentKind === 'both') return ['invoice', 'fiscal-receipt'];
  if (documentKind === 'invoice' || documentKind === 'fiscal-receipt') return [documentKind];
  return [];
}

export interface DueRun {
  slot: DueBatchSlot;
  kinds: SalesDocumentKind[];
}

/** Due slots per kind, grouped so kinds sharing an instant and segment run together. */
export function collectDueRuns(connection: Connection, now: Date): DueRun[] {
  const runs = new Map<string, DueRun>();
  for (const kind of kindsIssuedBy(connection)) {
    if (resolveTriggerModelForKind(connection.config, kind).model !== 'batched') continue;
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
  ) {}

  async execute(_job: SyncJob): Promise<SyncJobHandlerResult> {
    const now = new Date();
    const candidates = (await this.connections.list({ status: 'active' })).filter(
      (connection) =>
        connection.enabledCapabilities.includes(INVOICING_CAPABILITY) ||
        connection.enabledCapabilities.includes(FISCALIZATION_CAPABILITY),
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

    if (enqueued > 0 || failed > 0) {
      this.logger.log(
        `salesDocument.batch.tick: enqueued=${String(enqueued)} failed=${String(failed)}`,
      );
    }
    return { outcome: 'ok' };
  }
}
