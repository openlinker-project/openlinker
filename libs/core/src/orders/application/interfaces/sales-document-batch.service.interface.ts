/**
 * Sales-document batch service interface (#3583, epic #3515)
 *
 * Reads a connection's batch queue and runs it. A run re-evaluates each queued
 * order through the auto-issue gate and enqueues the ordinary per-order
 * issuance job; it never issues a document itself.
 *
 * Lives in `orders` because a run needs the order record (this context) and
 * the gate (`invoicing`), and `orders -> invoicing` is the allowed direction:
 * invoicing must not import orders (its F3 one-way edge).
 *
 * Every modelled outcome leaves through the result type; the methods throw
 * only for infrastructure faults.
 *
 * @module libs/core/src/orders/application/interfaces
 */
import type {
  BatchSchedule,
  BatchRunSegment,
  DueBatchSlot,
  SalesDocumentKind,
} from '@openlinker/core/sales-documents';
import type {
  SalesDocumentBatchRun,
  SalesDocumentBatchRunItem,
} from '../../domain/entities/sales-document-batch-run.entity';
import type {
  SalesDocumentBatchRunRefusal,
  SalesDocumentBatchItemOutcome,
  SalesDocumentBatchQueueEntry,
  SalesDocumentBatchRunTrigger,
} from '../../domain/types/sales-document-batch-run.types';

export interface ExecuteSalesDocumentBatchRunInput {
  connectionId: string;
  trigger: SalesDocumentBatchRunTrigger;
  documentKinds: readonly SalesDocumentKind[];
  segment: BatchRunSegment;
  slotAt: Date | null;
  startedByUserId: string | null;
}

export type ExecuteSalesDocumentBatchRunResult =
  | { status: 'finished'; run: SalesDocumentBatchRun }
  | { status: 'already-running'; runningRunId: string | null };

export interface SalesDocumentBatchRunItemView {
  item: SalesDocumentBatchRunItem;
  outcome: SalesDocumentBatchItemOutcome;
  /** Source order number; `null` when absent. */
  orderNumber: string | null;
  /** Buyer name; `null` when absent or not stored (PII off). */
  buyerName: string | null;
  /** The number the issued document bears; `null` until one is assigned. */
  documentNumber: string | null;
}

export interface SalesDocumentBatchRunDetail {
  run: SalesDocumentBatchRun;
  items: SalesDocumentBatchRunItemView[];
}

/** One document kind's batching state on a connection, as a screen shows it. */
export interface SalesDocumentBatchKindOverview {
  documentKind: SalesDocumentKind;
  /** The kind's trigger model resolves to `batched`. */
  batched: boolean;
  /** The stored schedule, `null` when none is readable. */
  schedule: BatchSchedule | null;
  /** The next slot per segment; empty without a schedule. */
  nextSlots: DueBatchSlot[];
}

export interface SalesDocumentBatchOverview {
  connectionId: string;
  kinds: SalesDocumentBatchKindOverview[];
  queueCounts: Record<string, number>;
  runningRun: SalesDocumentBatchRun | null;
}

export type RequestSalesDocumentBatchRunResult =
  | { status: 'enqueued'; jobId: string; documentKinds: SalesDocumentKind[] }
  | { status: 'refused'; reason: SalesDocumentBatchRunRefusal };

/** What one pass over untargeted batched blocks did. */
export interface RequeueUntargetedBatchedResult {
  /** Orders re-evaluated through the gate. */
  evaluated: number;
  /** Re-evaluations that could not be decided; those orders stay untargeted. */
  indeterminate: number;
}

export interface ISalesDocumentBatchService {
  /** Orders waiting in a connection's queue, keyset-paged by order id. */
  listQueue(
    connectionId: string,
    options: { documentKind?: SalesDocumentKind; afterOrderId?: string; limit: number },
  ): Promise<SalesDocumentBatchQueueEntry[]>;

  /**
   * A connection's schedules, next slots, queue counts and running run - the
   * batch screen's overview. `null` when the connection does not exist. Next
   * slots come from the same pure rules the worker's tick fires on.
   */
  getOverview(connectionId: string, now: Date): Promise<SalesDocumentBatchOverview | null>;

  /**
   * "Run now": refuse with a stated reason, or enqueue the SAME
   * `salesDocument.batch.run` job a scheduled slot does, covering every kind
   * the connection batches and the whole queue (B2B and B2C). The run itself
   * re-checks the connection when it starts.
   */
  requestRun(input: {
    connectionId: string;
    startedByUserId: string;
  }): Promise<RequestSalesDocumentBatchRunResult>;

  /** Queued orders per kind. */
  countQueue(connectionId: string): Promise<Record<string, number>>;

  /** The connection's run in progress, if any. */
  findRunning(connectionId: string): Promise<SalesDocumentBatchRun | null>;

  /**
   * Run the queue: claim the connection, check it can issue, re-evaluate each
   * queued order (one at a time, M15 note 8) and record what happened. Never
   * throws for an order: a per-order failure becomes an `indeterminate` item.
   */
  executeRun(input: ExecuteSalesDocumentBatchRunInput): Promise<ExecuteSalesDocumentBatchRunResult>;

  /** Newest first. */
  listRuns(
    connectionId: string,
    page: { limit: number; offset: number },
  ): Promise<{ runs: SalesDocumentBatchRun[]; total: number }>;

  /**
   * Re-evaluate orders whose `trigger-model-batched` block names no target
   * connection (written before the target columns existed), so each lands in
   * its connection's queue or leaves the batched state. Bounded per call; the
   * tick calls it every pass until none remain. Never throws for an order.
   */
  requeueUntargetedBatched(): Promise<RequeueUntargetedBatchedResult>;

  /** A run with each item's outcome, derived from the order's documents now. */
  getRun(runId: string): Promise<SalesDocumentBatchRunDetail | null>;
}
