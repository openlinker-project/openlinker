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
import type { JobOutcome, JobStatus } from '../api/sync-jobs.types';

const BASE_TONE: Record<JobStatus, StatusBadgeTone> = {
  queued: 'info',
  running: 'review',
  succeeded: 'success',
  dead: 'error',
};

interface SyncJobStatusBadgeProps {
  status: string;
  outcome?: JobOutcome | null;
}

function deriveTone(status: string, outcome: JobOutcome | null | undefined): StatusBadgeTone {
  if (status === 'succeeded' && outcome === 'business_failure') {
    return 'warning';
  }
  return BASE_TONE[status as JobStatus] ?? 'neutral';
}

export function SyncJobStatusBadge({ status, outcome = null }: SyncJobStatusBadgeProps): ReactElement {
  // Label stays the literal status word — the warning tone alone carries the
  // succeeded-with-business-failure signal. The outcome chip on the detail
  // page (Plan A's OfferCreationTracker) provides the explicit narrative.
  const tone = deriveTone(status, outcome);
  return (
    <StatusBadge tone={tone} withDot>
      {status}
    </StatusBadge>
  );
}
