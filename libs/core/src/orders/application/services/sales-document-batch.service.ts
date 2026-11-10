/**
 * Sales-document batch service (#3583, epic #3515)
 *
 * Runs one connection's batch queue. The queue is the set of orders the
 * auto-issue gate reported as `trigger-model-batched` for this connection
 * (persisted by `OrderRecordService.markSalesDocumentBlock` with its target).
 *
 * ## A run is a record over ordinary jobs
 *
 * Each queued order is rebuilt from its snapshot and handed back to the SAME
 * gate the ingestion path calls, with `options.batchRun` naming this
 * connection and its kinds. Inside the run the gate proceeds and enqueues the
 * usual `invoicing.issue` / `fiscalization.register` job under the usual
 * deterministic key, so routing, the tax-rate gate, the one-document-per-order
 * guard (#2047) and the per-order issue lock all apply unchanged. The outcome
 * is persisted through the same writer ingestion uses, so an enqueued order
 * leaves the queue and a re-blocked one carries its new reason.
 *
 * ## One at a time
 *
 * Orders are evaluated sequentially (M15 note 8). The issuance jobs serialise
 * on `invoice:issue:{orderId}` anyway, and a sequential loop keeps each item a
 * true record of the order it names.
 *
 * ## Refusal before the queue is touched
 *
 * A connection that is missing or not `active` (`needs_reauth` named apart,
 * because its remedy differs) finishes the run `failed-to-start` and evaluates
 * no order - the queue is left exactly as it was.
 *
 * @module libs/core/src/orders/application/services
 */
import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  CONNECTION_PORT_TOKEN,
  ConnectionNotFoundException,
  type Connection,
  type ConnectionPort,
} from '@openlinker/core/identifier-mapping';
import {
  AUTO_ISSUE_TRIGGER_SERVICE_TOKEN,
  IAutoIssueTriggerService,
  resolveTriggerModelForKind,
} from '@openlinker/core/invoicing';
import {
  findNextBatchSlots,
  readBatchSchedule,
  type SalesDocumentBlockOutcome,
  type SalesDocumentKind,
  type SalesDocumentView,
} from '@openlinker/core/sales-documents';
import {
  JOB_ENQUEUE_TOKEN,
  type JobEnqueuePort,
  type SalesDocumentBatchRunPayloadV1,
} from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  SALES_DOCUMENT_BATCH_RUN_REPOSITORY_TOKEN,
  SALES_DOCUMENT_VIEW_SERVICE_TOKEN,
} from '../../orders.tokens';
import type { SalesDocumentBatchRun } from '../../domain/entities/sales-document-batch-run.entity';
import { batchedDocumentKinds } from '../../domain/batched-document-kinds';
import { orderFromReadySnapshot } from '../../domain/order-from-ready-snapshot';
import { SalesDocumentBatchRunRepositoryPort } from '../../domain/ports/sales-document-batch-run-repository.port';
import {
  buildManualBatchRunKey,
  deriveBatchItemOutcome,
  type AppendSalesDocumentBatchRunItemInput,
  type SalesDocumentBatchQueueEntry,
  type SalesDocumentBatchRunFailureReason,
} from '../../domain/types/sales-document-batch-run.types';
import { IOrderRecordService } from '../interfaces/order-record.service.interface';
import { ISalesDocumentViewService } from '../interfaces/sales-document-view.service.interface';
import type {
  ExecuteSalesDocumentBatchRunInput,
  ExecuteSalesDocumentBatchRunResult,
  ISalesDocumentBatchService,
  RequestSalesDocumentBatchRunResult,
  RequeueUntargetedBatchedResult,
  SalesDocumentBatchOverview,
  SalesDocumentBatchRunDetail,
} from '../interfaces/sales-document-batch.service.interface';

/** The kinds a batch screen describes, whether or not the connection batches them. */
const SCREEN_KINDS: readonly SalesDocumentKind[] = ['invoice', 'fiscal-receipt'];

/** Queue page read per round trip. */
export const SALES_DOCUMENT_BATCH_PAGE_SIZE = 200;

/**
 * A `running` row older than this belongs to a process that died. Generous on
 * purpose: a long month-end run must never be declared dead while it works.
 */
export const SALES_DOCUMENT_BATCH_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Untargeted batched blocks re-evaluated per call (see
 * `requeueUntargetedBatched`). A one-off backlog left by the migration; the
 * tick drains it a bounded slice at a time.
 */
export const SALES_DOCUMENT_BATCH_REQUEUE_LIMIT = 500;

/**
 * Why a connection cannot run a batch now, or `null` when it can. ONE rule for
 * both the run (which records `failed-to-start`) and "Run now" (which refuses
 * before enqueuing); `needs_reauth` is named apart because its remedy differs.
 */
function connectionRefusal(
  connection: Connection,
): 'connection-needs-reauth' | 'connection-not-active' | null {
  if (connection.status === 'needs_reauth') return 'connection-needs-reauth';
  if (connection.status !== 'active') return 'connection-not-active';
  return null;
}

@Injectable()
export class SalesDocumentBatchService implements ISalesDocumentBatchService {
  private readonly logger = new Logger(SalesDocumentBatchService.name);

  constructor(
    @Inject(SALES_DOCUMENT_BATCH_RUN_REPOSITORY_TOKEN)
    private readonly runs: SalesDocumentBatchRunRepositoryPort,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connections: ConnectionPort,
    @Inject(AUTO_ISSUE_TRIGGER_SERVICE_TOKEN)
    private readonly autoIssueTrigger: IAutoIssueTriggerService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(SALES_DOCUMENT_VIEW_SERVICE_TOKEN)
    private readonly salesDocumentViews: ISalesDocumentViewService,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
  ) {}

  async getOverview(connectionId: string, now: Date): Promise<SalesDocumentBatchOverview | null> {
    const connection = await this.findConnection(connectionId);
    if (connection === null) return null;
    const kinds = SCREEN_KINDS.map((documentKind) => {
      const schedule = readBatchSchedule(connection.config, documentKind);
      return {
        documentKind,
        batched: resolveTriggerModelForKind(connection.config, documentKind).model === 'batched',
        schedule,
        nextSlots: schedule === null ? [] : findNextBatchSlots(schedule, now),
      };
    });
    const [queueCounts, runningRun] = await Promise.all([
      this.runs.countQueue(connectionId),
      this.runs.findRunning(connectionId, SALES_DOCUMENT_BATCH_STALE_AFTER_MS),
    ]);
    return { connectionId, kinds, queueCounts, runningRun };
  }

  async requestRun(input: {
    connectionId: string;
    startedByUserId: string;
  }): Promise<RequestSalesDocumentBatchRunResult> {
    const connection = await this.findConnection(input.connectionId);
    if (connection === null) return { status: 'refused', reason: 'connection-not-found' };
    const documentKinds = batchedDocumentKinds(connection.config);
    if (documentKinds.length === 0) return { status: 'refused', reason: 'not-batched' };
    const refusal = connectionRefusal(connection);
    if (refusal !== null) return { status: 'refused', reason: refusal };
    const running = await this.runs.findRunning(
      input.connectionId,
      SALES_DOCUMENT_BATCH_STALE_AFTER_MS,
    );
    if (running !== null) {
      return { status: 'refused', reason: 'run-in-progress' };
    }

    const payload: SalesDocumentBatchRunPayloadV1 = {
      schemaVersion: 1,
      trigger: 'manual',
      documentKinds,
      segment: 'all',
      startedByUserId: input.startedByUserId,
    };
    const result = await this.jobEnqueue.enqueueJob({
      jobType: 'salesDocument.batch.run',
      connectionId: input.connectionId,
      payload: payload as unknown as Record<string, unknown>,
      idempotencyKey: buildManualBatchRunKey(input.connectionId, randomUUID()),
    });
    return { status: 'enqueued', jobId: result.jobId, documentKinds };
  }

  listQueue(
    connectionId: string,
    options: { documentKind?: string; afterOrderId?: string; limit: number },
  ): Promise<SalesDocumentBatchQueueEntry[]> {
    return this.runs.listQueue({
      connectionId,
      documentKinds: options.documentKind === undefined ? undefined : [options.documentKind],
      afterOrderId: options.afterOrderId,
      limit: options.limit,
    });
  }

  countQueue(connectionId: string): Promise<Record<string, number>> {
    return this.runs.countQueue(connectionId);
  }

  findRunning(connectionId: string): Promise<SalesDocumentBatchRun | null> {
    return this.runs.findRunning(connectionId, SALES_DOCUMENT_BATCH_STALE_AFTER_MS);
  }

  async executeRun(
    input: ExecuteSalesDocumentBatchRunInput,
  ): Promise<ExecuteSalesDocumentBatchRunResult> {
    const run = await this.runs.claim(
      {
        connectionId: input.connectionId,
        trigger: input.trigger,
        documentKinds: input.documentKinds,
        segment: input.segment,
        slotAt: input.slotAt,
        startedByUserId: input.startedByUserId,
      },
      SALES_DOCUMENT_BATCH_STALE_AFTER_MS,
    );
    if (run === null) {
      const running = await this.runs.findRunning(
        input.connectionId,
        SALES_DOCUMENT_BATCH_STALE_AFTER_MS,
      );
      return { status: 'already-running', runningRunId: running?.id ?? null };
    }

    const refusal = await this.checkConnection(input.connectionId);
    if (refusal !== null) {
      await this.runs.finish(run.id, {
        status: 'failed-to-start',
        failureReason: refusal,
        eligibleCount: 0,
        enqueuedCount: 0,
        blockedCount: 0,
      });
      this.logger.warn(
        `Batch run ${run.id} for connection ${input.connectionId} failed to start: ${refusal}`,
      );
      return { status: 'finished', run: (await this.runs.findById(run.id)) ?? run };
    }

    let eligible = 0;
    let enqueued = 0;
    let blocked = 0;
    let afterOrderId: string | undefined;

    for (;;) {
      let page: SalesDocumentBatchQueueEntry[];
      try {
        page = await this.runs.listQueue({
          connectionId: input.connectionId,
          documentKinds: input.documentKinds,
          segment: input.segment,
          afterOrderId,
          limit: SALES_DOCUMENT_BATCH_PAGE_SIZE,
        });
      } catch (error) {
        // Before any order was read this is a failure to start; part-way
        // through it ends the run with what was done so far, and the rest stays
        // queued for the next run.
        const name = error instanceof Error ? error.name : 'UnknownError';
        this.logger.warn(`Batch run ${run.id} could not read its queue: error=${name}`);
        await this.runs.finish(run.id, {
          status: eligible === 0 ? 'failed-to-start' : 'completed',
          failureReason: eligible === 0 ? 'queue-read-failed' : null,
          eligibleCount: eligible,
          enqueuedCount: enqueued,
          blockedCount: blocked,
        });
        return { status: 'finished', run: (await this.runs.findById(run.id)) ?? run };
      }
      if (page.length === 0) break;

      for (const entry of page) {
        eligible += 1;
        const item = await this.runOne(entry, input);
        if (item.result === 'enqueued') enqueued += 1;
        if (item.result === 'blocked' || item.result === 'already-documented') blocked += 1;
        await this.runs.appendItem(run.id, item);
      }
      afterOrderId = page[page.length - 1].orderId;
      if (page.length < SALES_DOCUMENT_BATCH_PAGE_SIZE) break;
    }

    await this.runs.finish(run.id, {
      status: eligible === 0 ? 'empty' : 'completed',
      failureReason: null,
      eligibleCount: eligible,
      enqueuedCount: enqueued,
      blockedCount: blocked,
    });
    this.logger.log(
      `Batch run ${run.id} for connection ${input.connectionId} finished: ` +
        `eligible=${String(eligible)} enqueued=${String(enqueued)} blocked=${String(blocked)}`,
    );
    return { status: 'finished', run: (await this.runs.findById(run.id)) ?? run };
  }

  listRuns(
    connectionId: string,
    page: { limit: number; offset: number },
  ): Promise<{ runs: SalesDocumentBatchRun[]; total: number }> {
    return this.runs.listForConnection(connectionId, page);
  }

  async getRun(runId: string): Promise<SalesDocumentBatchRunDetail | null> {
    const run = await this.runs.findById(runId);
    if (run === null) return null;
    const items = await this.runs.listItems(runId);
    const enqueuedIds = items.filter((item) => item.result === 'enqueued').map((item) => item.orderId);
    const [views, labels] = await Promise.all([
      enqueuedIds.length === 0
        ? Promise.resolve(new Map<string, SalesDocumentView>())
        : this.salesDocumentViews.getForOrders(enqueuedIds),
      this.runs.findOrderLabels(items.map((item) => item.orderId)),
    ]);
    return {
      run,
      items: items.map((item) => {
        const document = views.get(item.orderId)?.document ?? null;
        const label = labels.get(item.orderId);
        return {
          item,
          outcome: deriveBatchItemOutcome(item.result, document),
          orderNumber: label?.orderNumber ?? null,
          buyerName: label?.buyerName ?? null,
          documentNumber: document?.identity.documentNumber ?? null,
        };
      }),
    };
  }

  /**
   * A `trigger-model-batched` block written before migration `1938780000000`
   * carries no target connection, so it sits in no queue - and since #3583 the
   * batched reason no longer counts as attention, so without this pass such an
   * order would be visible nowhere. Each is re-evaluated through the SAME gate
   * ingestion uses (outside any run), which writes the targeted block that
   * puts it in a queue, or whatever else applies now. An order the gate cannot
   * decide stays as it was and is retried on the next tick; keyset paging
   * within the call keeps such rows from starving the rest of the slice.
   */
  async requeueUntargetedBatched(): Promise<RequeueUntargetedBatchedResult> {
    let evaluated = 0;
    let indeterminate = 0;
    let afterOrderId: string | undefined;
    while (evaluated < SALES_DOCUMENT_BATCH_REQUEUE_LIMIT) {
      const ids = await this.runs.listUntargetedBatched({
        afterOrderId,
        limit: Math.min(SALES_DOCUMENT_BATCH_PAGE_SIZE, SALES_DOCUMENT_BATCH_REQUEUE_LIMIT - evaluated),
      });
      if (ids.length === 0) break;
      for (const orderId of ids) {
        evaluated += 1;
        if (!(await this.reevaluate(orderId))) indeterminate += 1;
      }
      afterOrderId = ids[ids.length - 1];
    }
    if (evaluated > 0) {
      this.logger.log(
        `Re-evaluated ${String(evaluated)} untargeted batched order(s); ` +
          `${String(indeterminate)} could not be decided and stay as they were`,
      );
    }
    return { evaluated, indeterminate };
  }

  /** Re-run the gate for one order outside any run. `false` when undecided. */
  private async reevaluate(orderId: string): Promise<boolean> {
    try {
      const record = await this.orderRecords.getOrderRecord(orderId);
      if (record === null) return false;
      const outcome = await this.autoIssueTrigger.onOrderTransition(
        orderFromReadySnapshot(record),
        record.sourceConnectionId,
        undefined,
        record.taxRateEra ?? null,
        record.buyerTaxId ?? null,
      );
      await this.persistOutcome(orderId, outcome);
      return outcome.kind !== 'indeterminate';
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`Could not re-evaluate untargeted batched order ${orderId}: error=${name}`);
      return false;
    }
  }

  private async checkConnection(
    connectionId: string,
  ): Promise<SalesDocumentBatchRunFailureReason | null> {
    const connection = await this.findConnection(connectionId);
    if (connection === null) return 'connection-not-found';
    return connectionRefusal(connection);
  }

  private async findConnection(connectionId: string): Promise<Connection | null> {
    try {
      return await this.connections.get(connectionId);
    } catch (error) {
      if (error instanceof ConnectionNotFoundException) return null;
      throw error;
    }
  }

  /** Evaluate one queued order and say what happened. Never throws. */
  private async runOne(
    entry: SalesDocumentBatchQueueEntry,
    input: ExecuteSalesDocumentBatchRunInput,
  ): Promise<AppendSalesDocumentBatchRunItemInput> {
    const indeterminate: AppendSalesDocumentBatchRunItemInput = {
      orderId: entry.orderId,
      documentKind: entry.documentKind,
      result: 'indeterminate',
      blockReason: null,
      idempotencyKey: null,
    };
    try {
      const record = await this.orderRecords.getOrderRecord(entry.orderId);
      if (record === null) return indeterminate;
      const order = orderFromReadySnapshot(record);

      const outcome = await this.autoIssueTrigger.onOrderTransition(
        order,
        record.sourceConnectionId,
        undefined,
        record.taxRateEra ?? null,
        record.buyerTaxId ?? null,
        // No bundle presentation here: it is derived at ingestion from the
        // incoming order, which a batch re-evaluation no longer has.
        undefined,
        { batchRun: { connectionId: input.connectionId, documentKinds: input.documentKinds } },
      );
      await this.persistOutcome(entry.orderId, outcome);
      return this.toItem(entry, outcome) ?? indeterminate;
    } catch (error) {
      // PII-safe: the error name and the order id only.
      const name = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(
        `Batch run could not evaluate order ${entry.orderId}; it stays queued: error=${name}`,
      );
      return indeterminate;
    }
  }

  /**
   * Same rule as ingestion: `indeterminate` writes nothing, anything else is
   * written level-triggered, which is what takes an enqueued order out of the
   * queue.
   */
  private async persistOutcome(orderId: string, outcome: SalesDocumentBlockOutcome): Promise<void> {
    if (outcome.kind === 'indeterminate') return;
    await this.orderRecords.markSalesDocumentBlock(
      orderId,
      outcome.kind === 'blocked' ? outcome.block : null,
      { action: 'set', matchedRuleId: outcome.matchedRuleId ?? null },
    );
  }

  private toItem(
    entry: SalesDocumentBatchQueueEntry,
    outcome: SalesDocumentBlockOutcome,
  ): AppendSalesDocumentBatchRunItemInput | null {
    switch (outcome.kind) {
      case 'indeterminate':
        return null;
      case 'blocked':
        return {
          orderId: entry.orderId,
          documentKind: outcome.block.documentKind ?? entry.documentKind,
          result: 'blocked',
          blockReason: outcome.block.reason,
          idempotencyKey: null,
        };
      case 'none':
        if (outcome.enqueued !== undefined) {
          return {
            orderId: entry.orderId,
            documentKind: outcome.enqueued.documentKind,
            result: 'enqueued',
            blockReason: null,
            idempotencyKey: outcome.enqueued.idempotencyKey,
          };
        }
        return {
          orderId: entry.orderId,
          documentKind: entry.documentKind,
          result: outcome.alreadyDocumented === true ? 'already-documented' : 'not-routed-here',
          blockReason: null,
          idempotencyKey: null,
        };
    }
  }
}
