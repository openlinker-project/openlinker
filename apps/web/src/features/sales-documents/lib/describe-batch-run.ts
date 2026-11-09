/**
 * Describe batch runs (#3584, mockup M15)
 *
 * Pure view-model rules for the batch-issuing screen: a run's status and
 * one-line result, and each order's outcome and detail. One place, so the
 * history table, the run details and the "Blocked" filter on the next-batch
 * tab cannot word the same fact two ways.
 *
 * An item's OUTCOME comes from the backend, which reads it from the order's
 * documents at read time (ADR-065); nothing here infers whether a document was
 * issued.
 *
 * Every function takes the `sales-documents` `batch` copy and a plural function
 * (`BatchCopyContext`), so the words come from the locale files and a test can
 * pin the language.
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import { interpolate, type Messages, type PluralFn, type ResolvedCopy } from '../../../shared/i18n';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { SalesDocumentGateBlockReasonValue } from '../../orders';
import type { BatchRun, BatchRunItem } from '../api/sales-document-batch.types';
import { resolveSalesDocumentReasonCopy } from './sales-document-reasons';

export interface BatchBadgeView {
  label: string;
  tone: StatusBadgeTone;
}

/** The `sales-documents` `batch` copy as resolved for the active language. */
export type BatchCopy = ResolvedCopy<Messages['sales-documents']>['batch'];

export interface BatchCopyContext {
  copy: BatchCopy;
  plural: PluralFn;
}

/** What an empty table cell shows: a plain hyphen, never an em dash. */
export const BATCH_EMPTY_CELL = '-';

/** A document kind as the copy keys spell it, or `null` for a kind this build does not know. */
export function batchKindKey(kind: string): 'invoice' | 'fiscalReceipt' | null {
  if (kind === 'invoice') return 'invoice';
  if (kind === 'fiscal-receipt') return 'fiscalReceipt';
  return null;
}

/** Sentences that belong together, kept one per key in the locale files. */
export function joinSentences(...sentences: string[]): string {
  return sentences.join(' ');
}

function failureReasonCopy(copy: BatchCopy, reason: string | null): string | undefined {
  switch (reason) {
    case 'connection-not-found':
      return copy.failureReason.connectionNotFound;
    case 'connection-needs-reauth':
      return copy.failureReason.connectionNeedsReauth;
    case 'connection-not-active':
      return copy.failureReason.connectionNotActive;
    case 'queue-read-failed':
      return copy.failureReason.queueReadFailed;
    default:
      return undefined;
  }
}

export function describeRunStatus(run: BatchRun, { copy }: BatchCopyContext): BatchBadgeView {
  switch (run.status) {
    case 'running':
      return { label: copy.runStatus.running, tone: 'info' };
    case 'completed':
      return run.blockedCount > 0
        ? { label: copy.runStatus.completedWithIssues, tone: 'warning' }
        : { label: copy.runStatus.completed, tone: 'success' };
    case 'empty':
      // M15 note 9: a healthy run that found nothing, never a failure.
      return { label: copy.runStatus.empty, tone: 'neutral' };
    case 'failed-to-start':
      return { label: copy.runStatus.failedToStart, tone: 'error' };
    case 'interrupted':
      return { label: copy.runStatus.interrupted, tone: 'warning' };
    default:
      return { label: run.status, tone: 'neutral' };
  }
}

/**
 * The history row's one-line result. A run records what it ENQUEUED; whether
 * each document was then issued is on the run's details, so the line says
 * "sent to issue" rather than claiming issuance.
 */
export function describeRunResult(run: BatchRun, { copy, plural }: BatchCopyContext): string {
  switch (run.status) {
    case 'running':
      return copy.runResult.inProgress;
    case 'empty':
      return copy.runResult.nothingEligible;
    case 'failed-to-start':
      return failureReasonCopy(copy, run.failureReason) ?? copy.runResult.couldNotStart;
    case 'interrupted':
      return copy.runResult.interrupted;
    default: {
      const parts = [plural(run.enqueuedCount, copy.runResult.sentToIssue)];
      if (run.blockedCount > 0) parts.push(plural(run.blockedCount, copy.runResult.blocked));
      const other = run.eligibleCount - run.enqueuedCount - run.blockedCount;
      if (other > 0) parts.push(plural(other, copy.runResult.notIssued));
      return parts.join(' · ');
    }
  }
}

/** `hh:mm:ss`, or `null` for a run that has not finished. */
export function formatRunDuration(run: BatchRun): string | null {
  if (run.finishedAt === null) return null;
  const ms = Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt));
  if (!Number.isFinite(ms)) return null;
  return formatElapsed(ms);
}

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** "in 3 h 12 min" until a future slot; "due now" once it has passed. */
export function formatTimeUntil(
  iso: string,
  now: Date,
  { copy, plural }: BatchCopyContext
): string {
  const minutes = Math.round((Date.parse(iso) - now.getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes <= 0) return copy.timeUntil.dueNow;
  if (minutes < 60) return interpolate(copy.timeUntil.minutes, { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return interpolate(copy.timeUntil.hours, { hours, minutes: minutes % 60 });
  }
  return plural(Math.floor(hours / 24), copy.timeUntil.days);
}

export function describeItemOutcome(
  item: BatchRunItem,
  { copy }: BatchCopyContext
): BatchBadgeView {
  switch (item.outcome) {
    case 'issued':
      return { label: copy.itemOutcome.issued, tone: 'success' };
    case 'pending':
      return { label: copy.itemOutcome.pending, tone: 'info' };
    case 'in-doubt':
      return { label: copy.itemOutcome.inDoubt, tone: 'review' };
    case 'failed':
      return { label: copy.itemOutcome.failed, tone: 'error' };
    case 'blocked':
      return { label: copy.itemOutcome.blocked, tone: 'warning' };
    case 'skipped':
      return { label: copy.itemOutcome.skipped, tone: 'neutral' };
    case 'needs-attention':
      return { label: copy.itemOutcome.needsAttention, tone: 'error' };
    default:
      return { label: item.outcome, tone: 'neutral' };
  }
}

export function describeItemDetail(
  item: BatchRunItem,
  providerName: string,
  { copy }: BatchCopyContext
): string {
  const detail = copy.itemDetail;
  switch (item.result) {
    case 'already-documented':
      return detail.alreadyDocumented;
    case 'not-routed-here':
      return detail.notRoutedHere;
    case 'indeterminate':
      return joinSentences(detail.indeterminate, detail.indeterminateStays);
    case 'blocked': {
      const reason = resolveSalesDocumentReasonCopy(
        item.blockReason as SalesDocumentGateBlockReasonValue | null
      );
      return reason?.detail ?? detail.blockedFallback;
    }
    default:
      break;
  }
  const provider = { provider: providerName };
  switch (item.outcome) {
    case 'issued':
      return item.documentNumber ?? detail.issued;
    case 'pending':
      return item.documentNumber ?? detail.pending;
    case 'in-doubt':
      return joinSentences(interpolate(detail.inDoubt, provider), detail.inDoubtRetry);
    case 'failed':
      return joinSentences(interpolate(detail.failed, provider), detail.openOrderWhy);
    case 'needs-attention':
      return joinSentences(detail.needsAttention, detail.openOrderCheck);
    default:
      return '';
  }
}

/** M15 run-detail metrics: issued, blocked, and what needs a person. */
export function summarizeRunItems(items: readonly BatchRunItem[]): {
  issued: number;
  blocked: number;
  attention: number;
  pending: number;
} {
  const summary = { issued: 0, blocked: 0, attention: 0, pending: 0 };
  for (const item of items) {
    if (item.outcome === 'issued') summary.issued += 1;
    else if (item.outcome === 'pending') summary.pending += 1;
    else if (item.outcome === 'blocked' || item.outcome === 'skipped') summary.blocked += 1;
    else summary.attention += 1;
  }
  return summary;
}

/**
 * An order the last run did NOT send to issue. These have left the queue (or
 * stay in it, for `indeterminate`), and the next-batch tab shows them under
 * "Blocked" so an order never silently drops out of view.
 */
export function isNotSentToIssue(item: BatchRunItem): boolean {
  return item.result !== 'enqueued';
}
