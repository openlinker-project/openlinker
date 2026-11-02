/**
 * Sales-document batch run (#3583)
 *
 * One run of a connection's batch queue. Anemic per ADR-011: every field is
 * `readonly`; the run moves `running` -> a terminal status through narrow
 * conditional repository writes.
 *
 * @module libs/core/src/orders/domain/entities
 */
import type { BatchRunSegment, SalesDocumentKind } from '@openlinker/core/sales-documents';
import type {
  SalesDocumentBatchRunFailureReason,
  SalesDocumentBatchRunItemResult,
  SalesDocumentBatchRunStatus,
  SalesDocumentBatchRunTrigger,
} from '../types/sales-document-batch-run.types';

export class SalesDocumentBatchRun {
  constructor(
    public readonly id: string,
    public readonly connectionId: string,
    public readonly trigger: SalesDocumentBatchRunTrigger,
    public readonly documentKinds: readonly SalesDocumentKind[],
    public readonly segment: BatchRunSegment,
    /** The schedule slot this run covers; `null` for "Run now". */
    public readonly slotAt: Date | null,
    public readonly status: SalesDocumentBatchRunStatus,
    public readonly failureReason: SalesDocumentBatchRunFailureReason | null,
    public readonly eligibleCount: number,
    public readonly enqueuedCount: number,
    public readonly blockedCount: number,
    public readonly startedByUserId: string | null,
    public readonly startedAt: Date,
    public readonly finishedAt: Date | null,
  ) {}
}

/** What one run did with one order. */
export class SalesDocumentBatchRunItem {
  constructor(
    public readonly id: string,
    public readonly runId: string,
    public readonly orderId: string,
    public readonly documentKind: SalesDocumentKind | null,
    public readonly result: SalesDocumentBatchRunItemResult,
    /** The gate reason for a `blocked` item; `null` otherwise. */
    public readonly blockReason: string | null,
    /** The issuance job's key for an `enqueued` item; `null` otherwise. */
    public readonly idempotencyKey: string | null,
    public readonly createdAt: Date,
  ) {}
}
