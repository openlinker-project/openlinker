/**
 * Sales-document batch run - vocabulary and pure rules (#3583, epic #3515)
 *
 * A batch run issues the orders waiting in one connection's batch queue. It is
 * a RECORD over ordinary per-order issuance jobs, not a new way of issuing:
 * each order is re-evaluated by the auto-issue gate and, when it still
 * qualifies, enqueued as the usual `invoicing.issue` / `fiscalization.register`
 * job under its usual idempotency key.
 *
 * ## What is stored and what is derived
 *
 * A run item stores what the RUN did with the order (enqueued it, found it
 * blocked, found it already documented). Whether the document was then issued,
 * is in doubt or failed is NOT stored: it is read from the order's
 * sales-document projection (ADR-065) when the run is shown, by
 * `deriveBatchItemOutcome`. Storing it would be a second record of the
 * document's state, able to disagree with the real one.
 *
 * ## The `*.types.ts` pure-rule exception applies
 *
 * `deriveBatchItemOutcome` and `isBatchQueueB2b` are pure and are the rules for
 * the types beside them.
 *
 * @module libs/core/src/orders/domain/types
 */
import type {
  BatchRunSegment,
  SalesDocumentKind,
  SalesDocumentRecordView,
} from '@openlinker/core/sales-documents';
import { decodeBuyerTaxIdColumn } from './buyer-tax-id.types';

export const SalesDocumentBatchRunTriggerValues = ['schedule', 'manual'] as const;
export type SalesDocumentBatchRunTrigger = (typeof SalesDocumentBatchRunTriggerValues)[number];

/**
 * - `running`         - in progress; at most one per connection (unique index).
 * - `completed`       - went through its queue; per-order results are on the items.
 * - `empty`           - started fine and found nothing eligible. A HEALTHY run,
 *   kept distinct from `failed-to-start` (M15 note 9).
 * - `failed-to-start` - refused before touching the queue; `failureReason` says why.
 * - `interrupted`     - left `running` by a process that died; closed by the next
 *   claim so the connection is not blocked for ever.
 */
export const SalesDocumentBatchRunStatusValues = [
  'running',
  'completed',
  'empty',
  'failed-to-start',
  'interrupted',
] as const;
export type SalesDocumentBatchRunStatus = (typeof SalesDocumentBatchRunStatusValues)[number];

export const SalesDocumentBatchRunFailureReasonValues = [
  'connection-not-found',
  'connection-needs-reauth',
  'connection-not-active',
  'queue-read-failed',
] as const;
export type SalesDocumentBatchRunFailureReason =
  (typeof SalesDocumentBatchRunFailureReasonValues)[number];

/** Why "Run now" was refused, before any job was enqueued. */
export const SalesDocumentBatchRunRefusalValues = [
  'connection-not-found',
  'not-batched',
  'connection-needs-reauth',
  'connection-not-active',
  'run-in-progress',
] as const;
export type SalesDocumentBatchRunRefusal = (typeof SalesDocumentBatchRunRefusalValues)[number];

/**
 * What the run did with one order.
 *
 * - `enqueued`           - its issuance job was enqueued.
 * - `blocked`            - the gate blocked it for a reason stored beside it.
 * - `already-documented` - it already carries a document on some connection
 *   (one document per order, #2047), so nothing was enqueued (M15 note 5).
 * - `not-routed-here`    - routing no longer sends it to this connection and kind.
 * - `indeterminate`      - the run could not evaluate it (unreadable snapshot,
 *   unexpected error); it stays queued for the next run.
 */
export const SalesDocumentBatchRunItemResultValues = [
  'enqueued',
  'blocked',
  'already-documented',
  'not-routed-here',
  'indeterminate',
] as const;
export type SalesDocumentBatchRunItemResult =
  (typeof SalesDocumentBatchRunItemResultValues)[number];

/** The outcome an operator reads per order, derived at read time (never stored). */
export const SalesDocumentBatchItemOutcomeValues = [
  'issued',
  'pending',
  'in-doubt',
  'failed',
  'blocked',
  'skipped',
  'needs-attention',
] as const;
export type SalesDocumentBatchItemOutcome = (typeof SalesDocumentBatchItemOutcomeValues)[number];

export interface CreateSalesDocumentBatchRunInput {
  connectionId: string;
  trigger: SalesDocumentBatchRunTrigger;
  documentKinds: readonly SalesDocumentKind[];
  segment: BatchRunSegment;
  slotAt: Date | null;
  startedByUserId: string | null;
}

export interface FinishSalesDocumentBatchRunInput {
  status: Exclude<SalesDocumentBatchRunStatus, 'running' | 'interrupted'>;
  failureReason: SalesDocumentBatchRunFailureReason | null;
  eligibleCount: number;
  enqueuedCount: number;
  blockedCount: number;
}

export interface AppendSalesDocumentBatchRunItemInput {
  orderId: string;
  documentKind: SalesDocumentKind | null;
  result: SalesDocumentBatchRunItemResult;
  blockReason: string | null;
  idempotencyKey: string | null;
}

/** One order waiting in a connection's batch queue. */
export interface SalesDocumentBatchQueueEntry {
  orderId: string;
  sourceConnectionId: string;
  documentKind: SalesDocumentKind;
  placedAt: Date | null;
  totalAmount: number | null;
  currency: string | null;
  /** Buyer has a tax id (D42: the month-end run issues these only). */
  isB2b: boolean;
  /** Source order number; `null` when the source sent none. */
  orderNumber: string | null;
  /** Billing (else shipping) name; `null` when absent or not stored (PII off). */
  buyerName: string | null;
}

export interface SalesDocumentBatchQueueFilter {
  connectionId: string;
  documentKinds?: readonly SalesDocumentKind[];
  segment?: BatchRunSegment;
  /** Keyset: return orders with an id greater than this one. */
  afterOrderId?: string;
  limit: number;
}

/**
 * The idempotency key of a scheduled run job. Derived from the SLOT, so a slot
 * the 5-minute tick sees on every pass until the next one is enqueued once:
 * `sync_jobs.idempotencyKey` is unique, which makes "one run per slot" a
 * database fact rather than a cursor to keep. Kinds are sorted so the same set
 * always produces the same key.
 */
export function buildScheduledBatchRunKey(input: {
  connectionId: string;
  documentKinds: readonly string[];
  segment: string;
  slotAt: Date;
}): string {
  const kinds = [...input.documentKinds].sort().join('+');
  return `salesDocument:batch:${input.connectionId}:${input.segment}:${kinds}:${input.slotAt.toISOString()}`;
}

/** The idempotency key of a "Run now" job: one per request, never deduped against a slot. */
export function buildManualBatchRunKey(connectionId: string, requestId: string): string {
  return `salesDocument:batch:${connectionId}:manual:${requestId}`;
}

/**
 * B2B for D42 is a buyer that asserted a tax id. Asserted-none AND unknown are
 * both B2C, so an order whose source never states a tax id is issued by the
 * daily run instead of waiting for a month end that would never take it.
 */
export function isBatchQueueB2b(buyerTaxIdColumn: string | null): boolean {
  const decoded = decodeBuyerTaxIdColumn(buyerTaxIdColumn);
  return typeof decoded === 'string' && decoded.length > 0;
}

/**
 * The operator-facing outcome of one run item.
 *
 * Only an `enqueued` item has a document to read; its outcome follows that
 * document: issued/registered, still on its way, failed in doubt (the provider
 * did not answer - safe to retry, M15 note 10) or refused. Every other result is
 * decided by the run itself.
 */
export function deriveBatchItemOutcome(
  result: SalesDocumentBatchRunItemResult,
  document: SalesDocumentRecordView | null,
): SalesDocumentBatchItemOutcome {
  switch (result) {
    case 'blocked':
    case 'already-documented':
      return 'blocked';
    case 'not-routed-here':
      return 'skipped';
    case 'indeterminate':
      return 'needs-attention';
    case 'enqueued':
      break;
  }
  if (document === null) {
    return 'pending';
  }
  if (document.status === 'issued' || document.status === 'registered') {
    return 'issued';
  }
  if (document.status === 'failed') {
    return document.failureMode === 'in-doubt' ? 'in-doubt' : 'failed';
  }
  return 'pending';
}
