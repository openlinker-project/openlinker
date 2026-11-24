/**
 * Sales-document batch run repository port (#3583)
 *
 * Runs, their items, and the batch queue read over `order_records`. There is no
 * `save(run)`: a run is claimed by an INSERT the partial unique index guards,
 * finished by a conditional UPDATE on `status = 'running'`, and its items are
 * append-only.
 *
 * @module libs/core/src/orders/domain/ports
 */
import type { OrderLabel } from '../order-label';
import type {
  SalesDocumentBatchRun,
  SalesDocumentBatchRunItem,
} from '../entities/sales-document-batch-run.entity';
import type {
  AppendSalesDocumentBatchRunItemInput,
  CreateSalesDocumentBatchRunInput,
  FinishSalesDocumentBatchRunInput,
  SalesDocumentBatchQueueEntry,
  SalesDocumentBatchQueueFilter,
} from '../types/sales-document-batch-run.types';

export interface SalesDocumentBatchRunRepositoryPort {
  /**
   * Start a run, or return `null` when the connection already has one
   * `running`. The refusal is the partial unique index, never a prior read, so
   * two simultaneous starts cannot both win. A run left `running` longer than
   * `staleAfterMs` (its process died) is closed as `interrupted` first.
   */
  claim(
    input: CreateSalesDocumentBatchRunInput,
    staleAfterMs: number,
  ): Promise<SalesDocumentBatchRun | null>;

  /** Close a running run. `false` when it is no longer `running`. */
  finish(runId: string, input: FinishSalesDocumentBatchRunInput): Promise<boolean>;

  appendItem(runId: string, input: AppendSalesDocumentBatchRunItemInput): Promise<void>;

  findById(runId: string): Promise<SalesDocumentBatchRun | null>;

  /**
   * The connection's live `running` run, or `null`. A row left `running` longer
   * than `staleAfterMs` belongs to a process that died, so it is NOT returned:
   * otherwise it would refuse "Run now" and show as in progress until a
   * scheduled slot happened to claim (and close) it. Read-only - only `claim`
   * closes such a row, as `interrupted`, with the same bound.
   */
  findRunning(connectionId: string, staleAfterMs: number): Promise<SalesDocumentBatchRun | null>;

  /** Newest first. */
  listForConnection(
    connectionId: string,
    page: { limit: number; offset: number },
  ): Promise<{ runs: SalesDocumentBatchRun[]; total: number }>;

  listItems(runId: string): Promise<SalesDocumentBatchRunItem[]>;

  /** Orders waiting in a connection's batch queue, keyset-paged by order id. */
  listQueue(filter: SalesDocumentBatchQueueFilter): Promise<SalesDocumentBatchQueueEntry[]>;

  /**
   * Orders carrying a `trigger-model-batched` block with NO target connection,
   * keyset-paged by order id. Such a block was written before the target
   * columns existed (migration `1938780000000`), so it sits in no connection's
   * queue - and the batched reason is no longer an attention reason either.
   * The tick re-evaluates them so each lands in a queue (or leaves the state).
   */
  listUntargetedBatched(page: { afterOrderId?: string; limit: number }): Promise<string[]>;

  /** Queued orders per document kind. */
  countQueue(connectionId: string): Promise<Record<string, number>>;

  /** Order number and buyer per order, for a run's rows. Unknown ids are absent. */
  findOrderLabels(orderIds: readonly string[]): Promise<Map<string, OrderLabel>>;
}
