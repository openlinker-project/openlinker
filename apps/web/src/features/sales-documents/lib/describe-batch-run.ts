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
 * @module apps/web/src/features/sales-documents/lib
 */
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { SalesDocumentGateBlockReasonValue } from '../../orders';
import type { BatchRun, BatchRunItem } from '../api/sales-document-batch.types';
import { resolveSalesDocumentReasonCopy } from './sales-document-reason-copy';

export interface BatchBadgeView {
  label: string;
  tone: StatusBadgeTone;
}

const FAILURE_REASON_COPY: Record<string, string> = {
  'connection-not-found': 'connection no longer exists',
  'connection-needs-reauth': 'connection needs reconnecting',
  'connection-not-active': 'connection is not active',
  'queue-read-failed': 'the queue could not be read',
};

export function describeRunStatus(run: BatchRun): BatchBadgeView {
  switch (run.status) {
    case 'running':
      return { label: 'Running', tone: 'info' };
    case 'completed':
      return run.blockedCount > 0
        ? { label: 'Completed with issues', tone: 'warning' }
        : { label: 'Completed', tone: 'success' };
    case 'empty':
      // M15 note 9: a healthy run that found nothing, never a failure.
      return { label: 'Nothing to issue', tone: 'neutral' };
    case 'failed-to-start':
      return { label: 'Failed to start', tone: 'error' };
    case 'interrupted':
      return { label: 'Interrupted', tone: 'warning' };
    default:
      return { label: run.status, tone: 'neutral' };
  }
}

/**
 * The history row's one-line result. A run records what it ENQUEUED; whether
 * each document was then issued is on the run's details, so the line says
 * "sent to issue" rather than claiming issuance.
 */
export function describeRunResult(run: BatchRun): string {
  switch (run.status) {
    case 'running':
      return 'in progress';
    case 'empty':
      return 'nothing eligible';
    case 'failed-to-start':
      return FAILURE_REASON_COPY[run.failureReason ?? ''] ?? 'could not start';
    case 'interrupted':
      return 'stopped before it finished';
    default: {
      const parts = [`${run.enqueuedCount} sent to issue`];
      if (run.blockedCount > 0) parts.push(`${run.blockedCount} blocked`);
      const other = run.eligibleCount - run.enqueuedCount - run.blockedCount;
      if (other > 0) parts.push(`${other} not issued`);
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
export function formatTimeUntil(iso: string, now: Date): string {
  const minutes = Math.round((Date.parse(iso) - now.getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes <= 0) return 'due now';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `in ${hours} h ${minutes % 60} min`;
  return `in ${Math.floor(hours / 24)} days`;
}

export function describeItemOutcome(item: BatchRunItem): BatchBadgeView {
  switch (item.outcome) {
    case 'issued':
      return { label: 'Issued', tone: 'success' };
    case 'pending':
      return { label: 'Issuing', tone: 'info' };
    case 'in-doubt':
      return { label: 'In doubt', tone: 'review' };
    case 'failed':
      return { label: 'Failed', tone: 'error' };
    case 'blocked':
      return { label: 'Blocked', tone: 'warning' };
    case 'skipped':
      return { label: 'Skipped', tone: 'neutral' };
    case 'needs-attention':
      return { label: 'Needs attention', tone: 'error' };
    default:
      return { label: item.outcome, tone: 'neutral' };
  }
}

export function describeItemDetail(item: BatchRunItem, providerName: string): string {
  switch (item.result) {
    case 'already-documented':
      return 'Already has a document on another connection.';
    case 'not-routed-here':
      return 'Routing no longer sends this order to this connection, so it was left alone.';
    case 'indeterminate':
      return 'Could not be checked during the run. It stays in the queue for the next one.';
    case 'blocked': {
      const copy = resolveSalesDocumentReasonCopy(
        item.blockReason as SalesDocumentGateBlockReasonValue | null
      );
      return copy?.detail ?? 'Blocked by the issuing rules.';
    }
    default:
      break;
  }
  switch (item.outcome) {
    case 'issued':
      return item.documentNumber ?? 'Issued.';
    case 'pending':
      return item.documentNumber ?? 'Sent to the provider, waiting for its answer.';
    case 'in-doubt':
      return `${providerName} did not answer in time, so OpenLinker does not know whether the document was created. Retrying cannot create a duplicate.`;
    case 'failed':
      return `${providerName} refused the document. Open the order to see why.`;
    case 'needs-attention':
      return 'Sent to issue, but no document was recorded. Open the order to check.';
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
