/**
 * Sync Job Status Badge
 *
 * Renders a semantic status badge for a sync job. Tone is derived from the
 * `(status, outcome)` pair so that succeeded-with-business-failure (issue
 * #400 — Plan B for #391) reads as warning rather than success — operators
 * scanning the list shouldn't see green for jobs whose underlying business
 * operation was rejected terminally.
 *
 * Mapping:
 * - succeeded + outcome=ok → success (green)
 * - succeeded + outcome=business_failure → warning (yellow)
 * - succeeded + outcome=null (legacy / pre-#400 row) → success
 * - queued → info
 * - running → review
 * - dead → error
 *
 * @module apps/web/src/features/sync-jobs/components
 */
import type { ReactElement } from 'react';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { JobOutcome, JobOutcomeReason, JobStatus } from '../api/sync-jobs.types';

const BASE_TONE: Record<JobStatus, StatusBadgeTone> = {
  queued: 'info',
  running: 'review',
  succeeded: 'success',
  dead: 'error',
};

/**
 * Human label per `outcomeReason` code (#1689) — resolved only on the
 * succeeded + business_failure path. An unknown/absent code falls back to
 * the generic "business failure" label rather than a raw status word, so a
 * deletion-caused failure reads distinctly from any other business
 * rejection (e.g. an offer-creation validation error).
 */
const OUTCOME_REASON_LABEL: Record<JobOutcomeReason, string> = {
  master_deleted: 'source deleted',
};

interface SyncJobStatusBadgeProps {
  status: string;
  outcome?: JobOutcome | null;
  outcomeReason?: JobOutcomeReason | null;
}

function deriveTone(status: string, outcome: JobOutcome | null | undefined): StatusBadgeTone {
  if (status === 'succeeded' && outcome === 'business_failure') {
    return 'warning';
  }
  return BASE_TONE[status as JobStatus] ?? 'neutral';
}

function deriveLabel(
  status: string,
  outcome: JobOutcome | null | undefined,
  outcomeReason: JobOutcomeReason | null | undefined,
): string {
  if (status === 'succeeded' && outcome === 'business_failure') {
    return (outcomeReason && OUTCOME_REASON_LABEL[outcomeReason]) ?? 'business failure';
  }
  return status;
}

export function SyncJobStatusBadge({
  status,
  outcome = null,
  outcomeReason = null,
}: SyncJobStatusBadgeProps): ReactElement {
  const tone = deriveTone(status, outcome);
  const label = deriveLabel(status, outcome, outcomeReason);
  return (
    <StatusBadge tone={tone} withDot>
      {label}
    </StatusBadge>
  );
}
