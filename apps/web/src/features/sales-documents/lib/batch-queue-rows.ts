/**
 * Batch queue rows (#3584, mockup M15 "Next batch")
 *
 * The next-batch table shows two kinds of row, told apart by the chips:
 *
 * - an order WAITING in the queue, with the kind routing will issue;
 * - an order the LAST finished run did not send to issue (blocked, already
 *   documented elsewhere, no longer routed here, or not checkable), with its
 *   reason. Without these, an order the gate refused would simply vanish from
 *   the queue and an operator could not tell it apart from one that was issued
 *   (M15: "those show up here as Blocked instead of silently dropping out").
 *
 * An `indeterminate` order is in both sets (it stays queued); it is shown once,
 * as blocked, because the reason is what the operator needs.
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import { ApiError } from '../../../shared/api/api-error';
import type {
  BatchQueueEntry,
  BatchRunItem,
  BatchRunRefusalCode,
} from '../api/sales-document-batch.types';
import { isNotSentToIssue } from './describe-batch-run';

export const BatchQueueFilterValues = ['all', 'invoice', 'fiscal-receipt', 'blocked'] as const;
export type BatchQueueFilter = (typeof BatchQueueFilterValues)[number];

export type BatchQueueRow =
  | { kind: 'queued'; orderId: string; entry: BatchQueueEntry }
  | { kind: 'blocked'; orderId: string; item: BatchRunItem; entry: BatchQueueEntry | null };

export function buildBatchQueueRows(
  queue: readonly BatchQueueEntry[],
  lastRunItems: readonly BatchRunItem[]
): BatchQueueRow[] {
  const blocked = new Map<string, BatchRunItem>();
  for (const item of lastRunItems) {
    if (isNotSentToIssue(item)) blocked.set(item.orderId, item);
  }
  const queueById = new Map(queue.map((entry) => [entry.orderId, entry]));
  const rows: BatchQueueRow[] = queue
    .filter((entry) => !blocked.has(entry.orderId))
    .map((entry) => ({ kind: 'queued', orderId: entry.orderId, entry }));
  for (const item of blocked.values()) {
    rows.push({
      kind: 'blocked',
      orderId: item.orderId,
      item,
      entry: queueById.get(item.orderId) ?? null,
    });
  }
  return rows;
}

export function filterBatchQueueRows(
  rows: readonly BatchQueueRow[],
  filter: BatchQueueFilter
): BatchQueueRow[] {
  if (filter === 'all') return [...rows];
  if (filter === 'blocked') return rows.filter((row) => row.kind === 'blocked');
  return rows.filter((row) => row.kind === 'queued' && row.entry.documentKind === filter);
}

export function countBatchQueueRows(
  rows: readonly BatchQueueRow[]
): Record<BatchQueueFilter, number> {
  const counts: Record<BatchQueueFilter, number> = {
    all: rows.length,
    invoice: 0,
    'fiscal-receipt': 0,
    blocked: 0,
  };
  for (const row of rows) {
    if (row.kind === 'blocked') counts.blocked += 1;
    else if (row.entry.documentKind === 'invoice') counts.invoice += 1;
    else if (row.entry.documentKind === 'fiscal-receipt') counts['fiscal-receipt'] += 1;
  }
  return counts;
}

const RUN_NOW_REFUSAL_COPY: Record<BatchRunRefusalCode, string> = {
  CONNECTION_NOT_BATCHED: 'This connection does not issue any document in batches any more.',
  CONNECTION_NEEDS_REAUTH: 'Reconnect this connection before running a batch.',
  CONNECTION_NOT_ACTIVE: 'This connection is not active, so it cannot issue a batch.',
  BATCH_RUN_IN_PROGRESS: 'A batch run is already in progress. Wait for it to finish.',
};

/** Why "Run now" was refused, in the operator's words. */
export function describeRunNowError(error: unknown): string {
  if (error instanceof ApiError && typeof error.details === 'object' && error.details !== null) {
    const code = (error.details as { code?: unknown }).code;
    if (typeof code === 'string' && code in RUN_NOW_REFUSAL_COPY) {
      return RUN_NOW_REFUSAL_COPY[code as BatchRunRefusalCode];
    }
  }
  return error instanceof Error && error.message.length > 0
    ? error.message
    : 'The batch run could not be started.';
}
