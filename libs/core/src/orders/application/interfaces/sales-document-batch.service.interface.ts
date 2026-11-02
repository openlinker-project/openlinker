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
import type { BatchRunSegment, SalesDocumentKind } from '@openlinker/core/sales-documents';
import type {
  SalesDocumentBatchRun,
  SalesDocumentBatchRunItem,
} from '../../domain/entities/sales-document-batch-run.entity';
import type {
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
}

export interface SalesDocumentBatchRunDetail {
  run: SalesDocumentBatchRun;
  items: SalesDocumentBatchRunItemView[];
}

export interface ISalesDocumentBatchService {
  /** Orders waiting in a connection's queue, keyset-paged by order id. */
  listQueue(
    connectionId: string,
    options: { documentKind?: SalesDocumentKind; afterOrderId?: string; limit: number },
  ): Promise<SalesDocumentBatchQueueEntry[]>;

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

  /** A run with each item's outcome, derived from the order's documents now. */
  getRun(runId: string): Promise<SalesDocumentBatchRunDetail | null>;
}
